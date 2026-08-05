"""FastAPI app: CORS, error mapping, and route registration.

This module owns zero business logic -- see routes_plan.py/routes_garmin.py/
routes_body.py for the thin adapters, and service.py/garmin_sync.py/body_insights.py
for the actual logic they call.
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from ..garmin_sync import GarminRateLimitError, GarminSyncError
from ..parser import TrainingPlanValidationError
from ..strava_sync import StravaAuthError
from . import schemas
from .routes_body import router as body_router
from .routes_garmin import router as garmin_router
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
        content=schemas.ErrorResponse(category="rate_limited", message=str(exc)).model_dump(),
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


app.include_router(plan_router, tags=["plan"])
app.include_router(garmin_router, tags=["garmin"])
app.include_router(body_router, tags=["body"])
app.include_router(strava_router, tags=["strava"])


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
