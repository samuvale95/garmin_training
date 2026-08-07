"""Verifies the Supabase-issued JWT every request carries, and nothing else.

Newer Supabase projects (this one included) sign access tokens with a per-project
asymmetric key (ES256), not the legacy shared HS256 secret -- the project's JWKS
endpoint (`/auth/v1/.well-known/jwks.json`) only ever publishes public keys, and it
returned an EC key when this was wired up, which is what asymmetric signing looks
like. `PyJWKClient` fetches and caches that public key set, so verifying a token still
costs no per-request call to Supabase (only a cache refresh on an unrecognized `kid`,
e.g. after key rotation) while working with the key type this project actually uses.
"""

from __future__ import annotations

import os

import jwt
from fastapi import Header

# Supabase's default audience for access tokens; rejecting anything else keeps a token
# minted for a different purpose (e.g. a Supabase service-role key) from passing here.
SUPABASE_AUD = "authenticated"

# Every algorithm Supabase's signing keys may use across projects/rotations. The JWKS
# only ever contains the public half, so accepting this list is safe -- a token can
# only verify against a key that's actually published there.
_ALLOWED_ALGORITHMS = ["ES256", "RS256"]


class AuthError(Exception):
    """Raised for a missing, malformed, or invalid Supabase session -- mapped to 401 by
    `app.py`'s exception handler, the same way `GarminSyncError`/`StravaAuthError` are."""


_jwks_client: jwt.PyJWKClient | None = None


def _jwks_client_instance() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = os.getenv("SUPABASE_URL")
        if not url:
            raise RuntimeError("SUPABASE_URL is not configured")
        _jwks_client = jwt.PyJWKClient(f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json")
    return _jwks_client


def current_user_id(authorization: str | None = Header(default=None)) -> str:
    """The Supabase user id (`sub`) behind this request's bearer token.

    Every gated route depends on this, so an anonymous or forged request never reaches
    a handler at all -- there is no per-route auth check to forget.
    """
    # Local-dev escape hatch: skips Google sign-in entirely when there's no Supabase
    # project configured yet. Only kicks in when someone deliberately sets this var --
    # it must never be set in a deployed environment, since it accepts every request
    # unauthenticated as the same fixed user.
    dev_bypass_user_id = os.getenv("DEV_AUTH_BYPASS_USER_ID")
    if dev_bypass_user_id:
        return dev_bypass_user_id

    if not authorization or not authorization.startswith("Bearer "):
        raise AuthError("Missing or malformed Authorization header")
    token = authorization.removeprefix("Bearer ").strip()

    try:
        signing_key = _jwks_client_instance().get_signing_key_from_jwt(token)
        payload = jwt.decode(token, signing_key.key, algorithms=_ALLOWED_ALGORITHMS, audience=SUPABASE_AUD)
    except jwt.PyJWKClientError as exc:
        raise AuthError(f"Could not resolve signing key: {exc}") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(f"Invalid session: {exc}") from exc

    user_id = payload.get("sub")
    if not isinstance(user_id, str) or not user_id:
        raise AuthError("Token has no subject")
    return user_id
