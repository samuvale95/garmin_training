"""Strava connection, activity-match, and shoe-wear endpoints.

Thin adapters over `strava_sync.py`, following the same pattern as
`routes_garmin.py`: each handler builds a fresh `StravaSync()` -- now against a
per-user tokenstore materialized from Postgres, see `user_tokenstore.py` -- and runs
its (synchronous, blocking-I/O) call on a thread. Reads go through the shared TTL cache,
scoped per user -- they are the same handful of Strava calls the Oggi/Settimana screens
repeat constantly.
"""

from __future__ import annotations

import hashlib

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from ..strava_sync import StravaSync
from . import schemas
from .auth import current_user_id
from .cache import TTL_STRAVA_ATHLETE, TTL_STRAVA_MATCH, TTL_STRAVA_SHOES, cache
from .user_tokenstore import materialized_strava_paths

router = APIRouter()

STRAVA_NAMESPACES = ("strava:match", "strava:matches", "strava:shoes", "strava:athlete")


def _payload_key(payload: BaseModel) -> str:
    """A short, exact cache key for a request body.

    The match result depends on every field of every session (steps drive the "planned"
    side), so the key is a digest of the serialized payload rather than a hand-picked
    subset that could silently collide after an edit.
    """
    return hashlib.sha1(payload.model_dump_json().encode()).hexdigest()


def _run(user_id: str, work):
    """One `StravaSync` call against `user_id`'s tokenstore, persisted back on the way
    out -- the Strava analogue of `garmin_session.run`."""
    with materialized_strava_paths(user_id) as (tokenstore, shoestore):
        return work(StravaSync(tokenstore=str(tokenstore), shoestore=str(shoestore)))


@router.get("/strava/authorize", response_model=schemas.StravaAuthorizeResponse)
async def authorize() -> schemas.StravaAuthorizeResponse:
    # Not user-specific (just this app's own Strava client id/redirect URI), but still
    # behind the router-level auth gate: an anonymous visitor has no reason to start a
    # Strava OAuth handshake for an account they can never finish connecting.
    url = await run_in_threadpool(lambda: StravaSync().authorize_url())
    return schemas.StravaAuthorizeResponse(authorize_url=url)


@router.post("/strava/connect", response_model=schemas.StravaConnectResponse)
async def connect(
    payload: schemas.StravaConnectRequest, user_id: str = Depends(current_user_id)
) -> schemas.StravaConnectResponse:
    await run_in_threadpool(lambda: _run(user_id, lambda sync: sync.exchange_code(payload.code)))
    cache.invalidate(STRAVA_NAMESPACES, user_id)  # a different athlete may be behind this token
    return schemas.StravaConnectResponse(connected=True)


@router.get("/strava/status", response_model=schemas.StravaStatusResponse)
async def status(user_id: str = Depends(current_user_id)) -> schemas.StravaStatusResponse:
    result = await run_in_threadpool(lambda: _run(user_id, lambda sync: sync.connection_status()))
    return schemas.StravaStatusResponse(**result)


@router.post("/strava/disconnect", response_model=schemas.StravaDisconnectResponse)
async def disconnect(user_id: str = Depends(current_user_id)) -> schemas.StravaDisconnectResponse:
    await run_in_threadpool(lambda: _run(user_id, lambda sync: sync.disconnect()))
    cache.invalidate(STRAVA_NAMESPACES, user_id)
    return schemas.StravaDisconnectResponse(connected=False)


@router.get("/strava/athlete", response_model=schemas.AthleteProfileResponse)
async def athlete(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.AthleteProfileResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "strava:athlete",
            user_id,
            None,
            TTL_STRAVA_ATHLETE,
            lambda: _run(user_id, lambda sync: sync.athlete_profile()),
            refresh=refresh,
        )
    )
    return schemas.AthleteProfileResponse(**result)


@router.post("/strava/activity-match", response_model=schemas.StravaActivityMatchResponse)
async def activity_match(
    payload: schemas.StravaActivityMatchRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.StravaActivityMatchResponse:
    session = payload.session.to_model()
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "strava:match",
            user_id,
            _payload_key(payload),
            TTL_STRAVA_MATCH,
            lambda: _run(user_id, lambda sync: sync.find_activity_match(session)),
            refresh=refresh,
        )
    )
    return schemas.StravaActivityMatchResponse(**result)


@router.post("/strava/activity-matches", response_model=schemas.StravaActivityMatchesResponse)
async def activity_matches(
    payload: schemas.StravaActivityMatchesRequest, refresh: bool = False, user_id: str = Depends(current_user_id)
) -> schemas.StravaActivityMatchesResponse:
    sessions = [s.to_model() for s in payload.sessions]
    results = await run_in_threadpool(
        lambda: cache.get_or_call(
            "strava:matches",
            user_id,
            _payload_key(payload),
            TTL_STRAVA_MATCH,
            lambda: _run(user_id, lambda sync: sync.find_activity_matches_for_range(sessions)),
            refresh=refresh,
        )
    )
    return schemas.StravaActivityMatchesResponse(
        matches={date_key: schemas.StravaActivityMatchResponse(**match) for date_key, match in results.items()}
    )


@router.get("/strava/shoes", response_model=schemas.ShoesResponse)
async def shoes(refresh: bool = False, user_id: str = Depends(current_user_id)) -> schemas.ShoesResponse:
    result = await run_in_threadpool(
        lambda: cache.get_or_call(
            "strava:shoes",
            user_id,
            None,
            TTL_STRAVA_SHOES,
            lambda: _run(user_id, lambda sync: sync.shoe_wear()),
            refresh=refresh,
        )
    )
    return schemas.ShoesResponse(shoes=[schemas.ShoeOut(**s) for s in result])


@router.post("/strava/shoes/{gear_id}/retire", response_model=schemas.RetireShoeResponse)
async def retire_shoe(gear_id: str, user_id: str = Depends(current_user_id)) -> schemas.RetireShoeResponse:
    await run_in_threadpool(lambda: _run(user_id, lambda sync: sync.retire_shoe(gear_id)))
    cache.invalidate(("strava:shoes",), user_id)
    return schemas.RetireShoeResponse(id=gear_id, retired=True)
