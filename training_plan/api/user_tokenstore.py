"""Per-user Garmin/Strava credentials, held in Postgres instead of a file on disk.

`garmin_sync.GarminSync` and `strava_sync.StravaSync` are untouched -- both already take
a `tokenstore` path and read/write plain files there, which is exactly the shape this
module needs to sit underneath. For the duration of one call, a user's encrypted blob is
decrypted into a throwaway temp path, handed to the existing sync class, and whatever
that class wrote is read back and re-persisted before the temp path is removed. Nothing
above this module has to know the tokenstore ever left Postgres.

The blobs are encrypted at rest with a server-held key (`TOKEN_ENCRYPTION_KEY`): a Garmin
or Strava token is functionally equivalent to that account's password (full read access,
and for Garmin, delete access to workouts), so it gets the same treatment a password
hash would, not the treatment a cache entry would.
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from cryptography.fernet import Fernet, InvalidToken

from .. import db

SCHEMA = """
CREATE TABLE IF NOT EXISTS garmin_credentials (
  user_id    TEXT PRIMARY KEY,
  blob       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS strava_credentials (
  user_id    TEXT PRIMARY KEY,
  blob       BYTEA NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def ensure_schema() -> None:
    with db.connect() as conn:
        conn.execute(SCHEMA)


def _fernet() -> Fernet:
    key = os.getenv("TOKEN_ENCRYPTION_KEY")
    if not key:
        raise RuntimeError(
            "TOKEN_ENCRYPTION_KEY is not configured. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
        )
    return Fernet(key.encode())


# ---- directory <-> encrypted blob, for Garmin's tokenstore ---------------------------


def _pack_directory(directory: Path) -> bytes:
    """Every file under `directory`, relative path -> base64 content, as JSON bytes.
    Generic on purpose: `garth` (behind `garminconnect`) owns the exact filenames inside
    a tokenstore directory, and this must survive that changing between versions."""
    files: dict[str, str] = {}
    if directory.exists():
        for path in sorted(directory.rglob("*")):
            if path.is_file():
                rel = path.relative_to(directory).as_posix()
                files[rel] = base64.b64encode(path.read_bytes()).decode("ascii")
    return json.dumps(files).encode()


def _unpack_directory(packed: bytes, directory: Path) -> None:
    files: dict[str, str] = json.loads(packed.decode())
    for rel, content_b64 in files.items():
        target = directory / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(base64.b64decode(content_b64))


def _read_encrypted(table: str, user_id: str) -> bytes | None:
    with db.connect() as conn:
        row = conn.execute(f"SELECT blob FROM {table} WHERE user_id = %s", (user_id,)).fetchone()
    if row is None:
        return None
    try:
        return _fernet().decrypt(bytes(row[0]))
    except InvalidToken:
        # A key rotation or corrupted row: treat as "no cached credentials" rather than
        # crashing the request -- the caller falls back to a fresh login/reconnect.
        return None


def _write_encrypted(table: str, user_id: str, plaintext: bytes) -> None:
    encrypted = _fernet().encrypt(plaintext)
    with db.connect() as conn:
        conn.execute(
            f"""INSERT INTO {table} (user_id, blob, updated_at) VALUES (%s, %s, now())
                ON CONFLICT (user_id) DO UPDATE SET blob = EXCLUDED.blob, updated_at = now()""",
            (user_id, encrypted),
        )


def _delete_row(table: str, user_id: str) -> None:
    with db.connect() as conn:
        conn.execute(f"DELETE FROM {table} WHERE user_id = %s", (user_id,))


@contextmanager
def materialized_garmin_tokenstore(user_id: str) -> Iterator[Path]:
    """A temp directory holding this user's Garmin tokenstore for the life of the
    `with` block, persisted back to Postgres (or removed, if the block emptied it --
    `GarminSync.disconnect()` deletes the directory) on the way out."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="passo-garmin-"))
    try:
        packed = _read_encrypted("garmin_credentials", user_id)
        if packed is not None:
            _unpack_directory(packed, tmp_dir)
        yield tmp_dir
        if tmp_dir.exists() and any(tmp_dir.iterdir()):
            _write_encrypted("garmin_credentials", user_id, _pack_directory(tmp_dir))
        else:
            _delete_row("garmin_credentials", user_id)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@contextmanager
def materialized_strava_paths(user_id: str) -> Iterator[tuple[Path, Path]]:
    """(tokenstore file, shoestore file) for this user, for the life of the `with`
    block. Bundled into one Postgres row (`{"tokens": ..., "shoes": ...}`) since
    Strava's own module treats them as two files for one connection, not two
    independent resources."""
    tmp_dir = Path(tempfile.mkdtemp(prefix="passo-strava-"))
    tokenstore = tmp_dir / "tokens.json"
    shoestore = tmp_dir / "shoes.json"
    try:
        packed = _read_encrypted("strava_credentials", user_id)
        if packed is not None:
            bundle = json.loads(packed.decode())
            if bundle.get("tokens") is not None:
                tokenstore.write_text(json.dumps(bundle["tokens"]))
            if bundle.get("shoes") is not None:
                shoestore.write_text(json.dumps(bundle["shoes"]))

        yield tokenstore, shoestore

        tokens = json.loads(tokenstore.read_text()) if tokenstore.exists() else None
        shoes = json.loads(shoestore.read_text()) if shoestore.exists() else None
        if tokens is None and shoes is None:
            _delete_row("strava_credentials", user_id)
        else:
            bundle = {"tokens": tokens, "shoes": shoes}
            _write_encrypted("strava_credentials", user_id, json.dumps(bundle).encode())
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)
