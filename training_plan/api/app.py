"""FastAPI app: CORS, error mapping, and route registration.

This module owns zero business logic -- see routes_plan.py/routes_garmin.py/
routes_body.py for the thin adapters, and service.py/garmin_sync.py/body_insights.py
for the actual logic they call.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .. import db
from ..garmin_sync import GarminRateLimitError, GarminSyncError
from ..parser import TrainingPlanValidationError
from ..strava_sync import StravaAuthError
from . import schemas, user_tokenstore
from .auth import AuthError, current_user_id
from .cache import cache
from .routes_body import router as body_router
from .routes_garmin import router as garmin_router
from .routes_nutrition import router as nutrition_router
from .routes_plan import router as plan_router
from .routes_strava import router as strava_router

# The CLI (cli.py) calls this too, but `uvicorn training_plan.api:app` never goes
# through cli.py -- without this, GARMIN_EMAIL/GARMIN_PASSWORD/STRAVA_* in a local
# .env file are silently invisible to the server, only to shells that happen to
# export them some other way.
load_dotenv()

app = FastAPI(title="Passo training API")

allowed_origins = os.getenv("PASSO_WEB_ORIGIN", "http://localhost:3000").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _ensure_schema() -> None:
    """Create the food-log and credential tables if this is a fresh database.
    Idempotent (`CREATE TABLE IF NOT EXISTS`) and cheap enough to run once per process
    start rather than gating it behind a separate migration step for a two-table app."""
    db.ensure_schema()
    user_tokenstore.ensure_schema()


@app.exception_handler(AuthError)
async def _auth_error_handler(request: Request, exc: AuthError) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content=schemas.ErrorResponse(category="auth_failed", message=str(exc)).model_dump(),
    )


@app.exception_handler(TrainingPlanValidationError)
async def _validation_error_handler(request: Request, exc: TrainingPlanValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=schemas.ErrorResponse(
            category="validation_failed", message="Training plan is invalid", details=exc.errors
        ).model_dump(),
    )


@app.exception_handler(GarminRateLimitError)
async def _rate_limit_handler(request: Request, exc: GarminRateLimitError) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content=schemas.ErrorResponse(
            category="rate_limited",
            message=str(exc),
            retry_after_seconds=exc.retry_after_seconds,
        ).model_dump(),
    )


@app.exception_handler(GarminSyncError)
async def _garmin_error_handler(request: Request, exc: GarminSyncError) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content=schemas.ErrorResponse(category="auth_failed", message=str(exc)).model_dump(),
    )


@app.exception_handler(StravaAuthError)
async def _strava_auth_error_handler(request: Request, exc: StravaAuthError) -> JSONResponse:
    return JSONResponse(
        status_code=401,
        content=schemas.ErrorResponse(category="auth_failed", message=str(exc)).model_dump(),
    )


@app.exception_handler(Exception)
async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    return JSONResponse(
        status_code=500,
        content=schemas.ErrorResponse(category="server_error", message=str(exc)).model_dump(),
    )


# Every route in these five routers needs a signed-in caller -- `/health` is the one
# deliberate exception, checked by hosting platforms before any user ever gets there.
# The dependency's return value (the user id) isn't consumed at this level; handlers
# that need it declare their own `Depends(current_user_id)` parameter, which FastAPI
# resolves from the same per-request cache rather than re-verifying the token twice.
_auth_gate = [Depends(current_user_id)]
app.include_router(plan_router, tags=["plan"], dependencies=_auth_gate)
app.include_router(garmin_router, tags=["garmin"], dependencies=_auth_gate)
app.include_router(body_router, tags=["body"], dependencies=_auth_gate)
app.include_router(strava_router, tags=["strava"], dependencies=_auth_gate)
app.include_router(nutrition_router, tags=["nutrition"], dependencies=_auth_gate)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/cache/clear")
async def clear_cache(user_id: str = Depends(current_user_id)) -> dict:
    """Drop this user's cached reads, so their next request goes back to Garmin/Strava.

    This is the escape hatch behind the app's manual refresh: reads are cached for
    minutes at a time (see api/cache.py), which is what makes navigation instant, but
    the user must always have a way to say "no, ask again now". Scoped to the caller,
    not `cache.clear()`, now that the cache is shared by more than one person.
    """
    cache.invalidate_user(user_id)
    return {"cleared": True}
