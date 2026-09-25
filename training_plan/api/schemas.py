"""Pydantic request/response shapes for the FastAPI adapter.

These mirror the existing dataclasses in `training_plan.models`/`garmin_sync` field
for field. Nothing here changes what those dataclasses mean; this module only exists
so FastAPI can validate/serialize JSON at the HTTP boundary.
"""

from __future__ import annotations

import base64
from datetime import date as date_type
from datetime import datetime

from pydantic import BaseModel, Field

from .. import (
    body_insights,
    db,
    garmin_sync,
    goal_fit,
    intensity,
    models,
    nutrition,
    paces,
    prescription,
    readiness,
    technique,
)


# ---- plan / steps --------------------------------------------------------------------------


class PaceTargetOut(BaseModel):
    slower_sec_per_km: int
    faster_sec_per_km: int

    @classmethod
    def from_model(cls, target: models.PaceTarget | None) -> "PaceTargetOut | None":
        return None if target is None else cls(
            slower_sec_per_km=target.slower_sec_per_km, faster_sec_per_km=target.faster_sec_per_km
        )


class PaceTargetIn(BaseModel):
    slower_sec_per_km: int
    faster_sec_per_km: int

    def to_model(self) -> models.PaceTarget:
        return models.PaceTarget(
            slower_sec_per_km=self.slower_sec_per_km, faster_sec_per_km=self.faster_sec_per_km
        )


class StepIn(BaseModel):
    type: str
    duration_type: str
    duration_value: float
    target_pace: PaceTargetIn | None = None

    def to_model(self) -> models.Step:
        return models.Step(
            type=self.type,
            duration_type=self.duration_type,
            duration_value=self.duration_value,
            target_pace=self.target_pace.to_model() if self.target_pace else None,
        )


class StepOut(BaseModel):
    type: str
    duration_type: str
    duration_value: float
    target_pace: PaceTargetOut | None = None

    @classmethod
    def from_model(cls, step: models.Step) -> "StepOut":
        return cls(
            type=step.type,
            duration_type=step.duration_type,
            duration_value=step.duration_value,
            target_pace=PaceTargetOut.from_model(step.target_pace),
        )


class RepeatBlockIn(BaseModel):
    reps: int
    steps: list[StepIn] = Field(default_factory=list)

    def to_model(self) -> models.RepeatBlock:
        return models.RepeatBlock(reps=self.reps, steps=[s.to_model() for s in self.steps])


class RepeatBlockOut(BaseModel):
    reps: int
    steps: list[StepOut] = Field(default_factory=list)

    @classmethod
    def from_model(cls, block: models.RepeatBlock) -> "RepeatBlockOut":
        return cls(reps=block.reps, steps=[StepOut.from_model(s) for s in block.steps])


# A session's step list is heterogeneous, and the two shapes are told apart by their
# required fields alone (a block has `reps`, a step has `type`/`duration_*`), so no
# discriminator field is needed -- but the block must come first, since pydantic tries
# the members left to right.
SessionStepIn = RepeatBlockIn | StepIn
SessionStepOut = RepeatBlockOut | StepOut


class TrainingSessionIn(BaseModel):
    date: date_type
    sport: str
    title: str
    description: str | None = None
    steps: list[SessionStepIn] = Field(default_factory=list)

    def to_model(self) -> models.TrainingSession:
        return models.TrainingSession(
            date=self.date,
            sport=self.sport,
            title=self.title,
            description=self.description,
            steps=[s.to_model() for s in self.steps],
        )


class TrainingSessionOut(BaseModel):
    date: date_type
    sport: str
    title: str
    description: str | None = None
    steps: list[SessionStepOut] = Field(default_factory=list)

    @classmethod
    def from_model(cls, session: models.TrainingSession) -> "TrainingSessionOut":
        return cls(
            date=session.date,
            sport=session.sport,
            title=session.title,
            description=session.description,
            steps=[
                RepeatBlockOut.from_model(s) if isinstance(s, models.RepeatBlock) else StepOut.from_model(s)
                for s in session.steps
            ],
        )


class ParsePlanRequest(BaseModel):
    yaml_text: str


class RaceGoalOut(BaseModel):
    """The race the plan is written for. Every screen that reads it must also render
    without it -- `goal` is null for any plan that doesn't state one."""

    race_date: date_type
    distance_km: float
    name: str | None = None
    target_time_seconds: int | None = None
    # Derived, not stored: sent along so the phase label and the countdown are computed
    # in exactly one place (models.race_phase) rather than reimplemented per client.
    phase: str
    days_to_race: int

    @classmethod
    def from_model(cls, goal: models.RaceGoal) -> "RaceGoalOut":
        return cls(
            race_date=goal.race_date,
            distance_km=goal.distance_km,
            name=goal.name,
            target_time_seconds=goal.target_time_seconds,
            phase=models.race_phase(goal),
            days_to_race=models.days_to_race(goal),
        )

    def to_model(self) -> models.RaceGoal:
        return models.RaceGoal(
            race_date=self.race_date,
            distance_km=self.distance_km,
            name=self.name,
            target_time_seconds=self.target_time_seconds,
        )


class RaceGoalIn(BaseModel):
    """What a client may state. `phase`/`days_to_race` are absent on purpose: they are
    derived from the date, and accepting them would let a client claim a phase its own
    race date contradicts."""

    race_date: date_type
    distance_km: float = Field(gt=0)
    name: str | None = None
    target_time_seconds: int | None = Field(default=None, gt=0)

    def to_model(self) -> models.RaceGoal:
        return models.RaceGoal(
            race_date=self.race_date,
            distance_km=self.distance_km,
            name=self.name,
            target_time_seconds=self.target_time_seconds,
        )


class ParsePlanResponse(BaseModel):
    sessions: list[TrainingSessionOut]
    goal: RaceGoalOut | None = None


# ---- the active plan, persisted server-side ---------------------------------------------------


class PlanIn(BaseModel):
    yaml_text: str
    sessions: list[TrainingSessionIn]
    filename: str | None = None
    imported_at: str
    goal: RaceGoalIn | None = None


class PlanOut(BaseModel):
    yaml_text: str
    sessions: list[TrainingSessionOut]
    filename: str | None = None
    imported_at: str
    goal: RaceGoalOut | None = None

    @classmethod
    def from_model(cls, plan: db.UserPlan) -> "PlanOut":
        # The stored goal is the three stated facts; `phase` and `days_to_race` are
        # recomputed on every read, because both change with nothing but the date.
        goal = RaceGoalIn.model_validate(plan.goal).to_model() if plan.goal else None
        return cls(
            yaml_text=plan.yaml_text,
            sessions=[TrainingSessionOut.model_validate(s) for s in plan.sessions],
            filename=plan.filename,
            imported_at=plan.imported_at,
            goal=RaceGoalOut.from_model(goal) if goal else None,
        )


class PlanResponse(BaseModel):
    plan: PlanOut | None


# ---- the race goal, before any plan exists to hold it -------------------------------------


class GoalResponse(BaseModel):
    goal: RaceGoalOut | None = None


class SetGoalRequest(BaseModel):
    goal: RaceGoalIn | None = None


class DeletePlanResponse(BaseModel):
    ok: bool


# ---- diff -----------------------------------------------------------------------------------


class ScheduledWorkoutOut(BaseModel):
    scheduled_workout_id: int
    workout_id: int
    date: date_type
    sport: str
    title: str

    @classmethod
    def from_model(cls, workout: garmin_sync.ScheduledWorkout) -> "ScheduledWorkoutOut":
        return cls(
            scheduled_workout_id=workout.scheduled_workout_id,
            workout_id=workout.workout_id,
            date=workout.date,
            sport=workout.sport,
            title=workout.title,
        )


class ChangedSessionOut(BaseModel):
    session: TrainingSessionOut
    workout: ScheduledWorkoutOut
    local_hash: str
    remote_hash: str

    @classmethod
    def from_model(cls, changed: garmin_sync.ChangedSession) -> "ChangedSessionOut":
        return cls(
            session=TrainingSessionOut.from_model(changed.session),
            workout=ScheduledWorkoutOut.from_model(changed.workout),
            local_hash=changed.local_hash,
            remote_hash=changed.remote_hash,
        )


class ChangedSessionIn(BaseModel):
    """What the frontend echoes back to /plan/sync to request a replace.

    Carries the workout identity from a previously fetched diff, plus the (possibly
    user-edited, e.g. via the body-conflict screen) session to write in its place.
    """

    session: TrainingSessionIn
    scheduled_workout_id: int
    workout_id: int
    workout_date: date_type
    workout_sport: str
    workout_title: str

    def to_model(self) -> garmin_sync.ChangedSession:
        workout = garmin_sync.ScheduledWorkout(
            scheduled_workout_id=self.scheduled_workout_id,
            workout_id=self.workout_id,
            date=self.workout_date,
            sport=self.workout_sport,
            title=self.workout_title,
        )
        return garmin_sync.ChangedSession(
            session=self.session.to_model(), workout=workout, local_hash="", remote_hash=""
        )


class DiffRequest(BaseModel):
    sessions: list[TrainingSessionIn]
    check_content: bool = False


class DiffResponse(BaseModel):
    to_create: list[TrainingSessionOut]
    already_present: list[TrainingSessionOut]
    extra_on_garmin: list[ScheduledWorkoutOut]
    changed: list[ChangedSessionOut]
    content_checked: bool

    @classmethod
    def from_model(cls, diff: garmin_sync.PlanDiff) -> "DiffResponse":
        return cls(
            to_create=[TrainingSessionOut.from_model(s) for s in diff.to_create],
            already_present=[TrainingSessionOut.from_model(s) for s in diff.already_present],
            extra_on_garmin=[ScheduledWorkoutOut.from_model(w) for w in diff.extra_on_garmin],
            changed=[ChangedSessionOut.from_model(c) for c in diff.changed],
            content_checked=diff.content_checked,
        )


# ---- sync job ---------------------------------------------------------------------------------


class StartSyncRequest(BaseModel):
    to_create: list[TrainingSessionIn] = Field(default_factory=list)
    changed: list[ChangedSessionIn] = Field(default_factory=list)


class StartSyncResponse(BaseModel):
    job_id: str


class CancelSyncResponse(BaseModel):
    ok: bool


class SyncItemResult(BaseModel):
    date: date_type
    sport: str
    title: str
    kind: str  # "create" | "replace"
    status: str  # "pending" | "ok" | "failed"
    error: str | None = None


class SyncJobStatus(BaseModel):
    job_id: str
    total: int
    completed: int
    status: str  # "running" | "done" | "cancelled" | "failed"
    cancel_requested: bool
    items: list[SyncItemResult]
    failure: str | None = None
    failure_category: str | None = None  # "auth_failed" | "rate_limited"


# ---- garmin connection --------------------------------------------------------------------


class ConnectRequest(BaseModel):
    email: str
    password: str
    mfa_code: str | None = None


class ConnectResponse(BaseModel):
    connected: bool


class GarminStatusResponse(BaseModel):
    connected: bool
    cooldown_active: bool
    retry_after_seconds: int = 0
    reason: str | None = None
    session_expires_in_days: int | None = None


class DeviceInfoResponse(BaseModel):
    device_name: str | None = None
    last_synced_at: datetime | None = None


class AthleteProfileResponse(BaseModel):
    """Who the connected account belongs to -- shared by /strava/athlete and
    /garmin/profile so the client can prefer one over the other without two shapes.
    Every field is optional: a connected account with no photo (or a name Garmin never
    filled in) is normal, and the avatar falls back on its own."""

    name: str | None = None
    image_url: str | None = None


class DisconnectResponse(BaseModel):
    connected: bool


class WorkoutsResponse(BaseModel):
    workouts: list[ScheduledWorkoutOut]


class CompletedActivityOut(BaseModel):
    activity_id: int
    date: date_type
    sport: str
    title: str
    distance_km: float | None
    duration_min: float | None

    @classmethod
    def from_model(cls, activity: garmin_sync.CompletedActivity) -> "CompletedActivityOut":
        return cls(
            activity_id=activity.activity_id,
            date=activity.date,
            sport=activity.sport,
            title=activity.title,
            distance_km=activity.distance_km,
            duration_min=activity.duration_min,
        )


class ActivitiesResponse(BaseModel):
    activities: list[CompletedActivityOut]


class DeletionPreviewRequest(BaseModel):
    start: date_type
    end: date_type
    sport: str | None = None
    title_match: str | None = None


class DeletionPreviewResponse(BaseModel):
    selected: list[ScheduledWorkoutOut]


class DeletionApplyRequest(BaseModel):
    workouts: list[ScheduledWorkoutOut]


class DeleteResultOut(BaseModel):
    workout: ScheduledWorkoutOut
    success: bool
    error: str | None = None


class DeletionApplyResponse(BaseModel):
    results: list[DeleteResultOut]


class RescheduleWorkoutRequest(BaseModel):
    workout: ScheduledWorkoutOut
    new_date: date_type


class RescheduleResultOut(BaseModel):
    workout: ScheduledWorkoutOut
    success: bool
    error: str | None = None

    @classmethod
    def from_model(cls, result: garmin_sync.RescheduleResult) -> "RescheduleResultOut":
        return cls(workout=ScheduledWorkoutOut.from_model(result.workout), success=result.success, error=result.error)


# ---- body insights --------------------------------------------------------------------------


class SleepPhasesOut(BaseModel):
    deep_minutes: int | None = None
    light_minutes: int | None = None
    rem_minutes: int | None = None
    awake_minutes: int | None = None
    total_minutes: int | None = None
    score: int | None = None
    score_label: str | None = None

    @classmethod
    def from_model(cls, phases: "body_insights.SleepPhases | None") -> "SleepPhasesOut | None":
        if phases is None:
            return None
        return cls(
            deep_minutes=phases.deep_minutes,
            light_minutes=phases.light_minutes,
            rem_minutes=phases.rem_minutes,
            awake_minutes=phases.awake_minutes,
            total_minutes=phases.total_minutes,
            score=phases.score,
            score_label=phases.score_label,
        )


class ReadinessFactorOut(BaseModel):
    key: str
    label: str
    percent: int | None = None
    verdict: str | None = None


class HrvPointOut(BaseModel):
    date: date_type
    value_ms: int | None


class BodySnapshotResponse(BaseModel):
    date: date_type
    has_overnight_data: bool
    readiness_score: int | None = None
    readiness_message: str | None = None
    readiness_level: str | None = None
    readiness_factors: list[ReadinessFactorOut] = Field(default_factory=list)
    sleep: SleepPhasesOut | None = None
    hrv_last_night_ms: int | None = None
    hrv_seven_day: list[HrvPointOut] = Field(default_factory=list)
    resting_heart_rate: int | None = None
    resting_heart_rate_delta: int | None = None
    battery_percent: int | None = None
    stress_level: int | None = None

    @classmethod
    def from_model(cls, snapshot: "body_insights.BodySnapshot") -> "BodySnapshotResponse":
        return cls(
            date=snapshot.date,
            has_overnight_data=snapshot.has_overnight_data,
            readiness_score=snapshot.readiness_score,
            readiness_message=snapshot.readiness_message,
            readiness_level=snapshot.readiness_level,
            readiness_factors=[
                ReadinessFactorOut(key=f.key, label=f.label, percent=f.percent, verdict=f.verdict)
                for f in snapshot.readiness_factors
            ],
            sleep=SleepPhasesOut.from_model(snapshot.sleep),
            hrv_last_night_ms=snapshot.hrv_last_night_ms,
            hrv_seven_day=[HrvPointOut(date=d, value_ms=v) for d, v in snapshot.hrv_seven_day],
            resting_heart_rate=snapshot.resting_heart_rate,
            resting_heart_rate_delta=snapshot.resting_heart_rate_delta,
            battery_percent=snapshot.battery_percent,
            stress_level=snapshot.stress_level,
        )


class WeeklyLoadOut(BaseModel):
    """Garmin-actual weekly load only. "Planned" volume comes from the plan, which is
    client-side-only (design.md's state-mapping table) -- the frontend merges this
    completed series with its own client-computed planned-per-week bars for the
    screen-12 histogram; the backend never sees "planned" data at all.
    """

    week_start: date_type
    completed_load: float | None
    in_progress: bool


class LoadSnapshotResponse(BaseModel):
    weeks: list[WeeklyLoadOut]
    acute_chronic_ratio: float | None = None
    vo2max: float | None = None

    @classmethod
    def from_model(cls, snapshot: "body_insights.LoadSnapshot") -> "LoadSnapshotResponse":
        return cls(
            weeks=[
                WeeklyLoadOut(
                    week_start=w.week_start,
                    completed_load=w.completed_load,
                    in_progress=w.in_progress,
                )
                for w in snapshot.weeks
            ],
            acute_chronic_ratio=snapshot.acute_chronic_ratio,
            vo2max=snapshot.vo2max,
        )


# ---- the plan, read against the race -------------------------------------------------------


class ObservationOut(BaseModel):
    key: str
    label: str
    detail: str
    severity: str


class WeekVolumeOut(BaseModel):
    week_start: date_type
    km: float
    sessions: int


class GoalFitRequest(BaseModel):
    """The sessions travel in the request for the same reason they do everywhere else:
    the plan lives on the device."""

    sessions: list[TrainingSessionIn] = Field(default_factory=list)
    goal: RaceGoalIn
    date: date_type | None = None


class GoalFitResponse(BaseModel):
    race_date: date_type
    days_to_race: int
    phase: str
    alignment: str
    headline: str
    observations: list[ObservationOut] = Field(default_factory=list)
    sessions_ahead: int
    weeks_covered: int
    last_session_date: date_type | None = None
    longest_run_km: float | None = None
    longest_run_date: date_type | None = None
    longest_run_guide_km: float | None = None
    peak_week_km: float | None = None
    weekly_volume: list[WeekVolumeOut] = Field(default_factory=list)
    quality_sessions: int = 0
    sessions_without_detail: int = 0

    @classmethod
    def from_model(cls, fit: "goal_fit.GoalFit") -> "GoalFitResponse":
        return cls(
            race_date=fit.race_date,
            days_to_race=fit.days_to_race,
            phase=fit.phase,
            alignment=fit.alignment,
            headline=fit.headline,
            observations=[
                ObservationOut(key=o.key, label=o.label, detail=o.detail, severity=o.severity)
                for o in fit.observations
            ],
            sessions_ahead=fit.sessions_ahead,
            weeks_covered=fit.weeks_covered,
            last_session_date=fit.last_session_date,
            longest_run_km=fit.longest_run_km,
            longest_run_date=fit.longest_run_date,
            longest_run_guide_km=fit.longest_run_guide_km,
            peak_week_km=fit.peak_week_km,
            weekly_volume=[
                WeekVolumeOut(week_start=w.week_start, km=round(w.km, 1), sessions=w.sessions)
                for w in fit.weekly_volume
            ],
            quality_sessions=fit.quality_sessions,
            sessions_without_detail=fit.sessions_without_detail,
        )


# ---- the day's verdict -------------------------------------------------------------------


class SignalOut(BaseModel):
    """One measurement that moved the verdict, carrying the figure that did it -- the
    screen shows these verbatim so the answer can be checked against the watch."""

    key: str
    label: str
    detail: str
    severity: str


class AlternativeOut(BaseModel):
    kind: str
    label: str
    detail: str


class DayVerdictRequest(BaseModel):
    """The plan lives on the device, so the session and the goal travel in the request --
    the same shape `/body/conflict` and `/nutrition/targets` already use."""

    date: date_type | None = None
    session: TrainingSessionIn | None = None
    goal: RaceGoalIn | None = None


class DayVerdictResponse(BaseModel):
    date: date_type
    state: str
    headline: str
    signals: list[SignalOut] = Field(default_factory=list)
    session_title: str | None = None
    session_demand: str | None = None
    action: str | None = None
    alternative: AlternativeOut | None = None
    phase: str | None = None
    has_data: bool = True

    @classmethod
    def from_model(cls, verdict: "readiness.DayVerdict") -> "DayVerdictResponse":
        return cls(
            date=verdict.date,
            state=verdict.state,
            headline=verdict.headline,
            signals=[SignalOut(key=s.key, label=s.label, detail=s.detail, severity=s.severity) for s in verdict.signals],
            session_title=verdict.session_title,
            session_demand=verdict.session_demand,
            action=verdict.action,
            alternative=(
                AlternativeOut(
                    kind=verdict.alternative.kind,
                    label=verdict.alternative.label,
                    detail=verdict.alternative.detail,
                )
                if verdict.alternative
                else None
            ),
            phase=verdict.phase,
            has_data=verdict.has_data,
        )


class ConflictOptionOut(BaseModel):
    kind: str
    label: str
    detail: str


class ConflictRequest(BaseModel):
    next_session: TrainingSessionIn | None = None


class ConflictResponse(BaseModel):
    has_conflict: bool
    signals: list[str] = Field(default_factory=list)
    options: list[ConflictOptionOut] = Field(default_factory=list)

    @classmethod
    def from_model(cls, assessment: "body_insights.ConflictAssessment") -> "ConflictResponse":
        return cls(
            has_conflict=assessment.has_conflict,
            signals=assessment.signals,
            options=[
                ConflictOptionOut(kind=o.kind, label=o.label, detail=o.detail)
                for o in assessment.options
            ],
        )


# ---- strava -------------------------------------------------------------------------------------


class StravaStatusResponse(BaseModel):
    connected: bool


class StravaAuthorizeResponse(BaseModel):
    authorize_url: str


class StravaConnectRequest(BaseModel):
    code: str


class StravaConnectResponse(BaseModel):
    connected: bool


class StravaDisconnectResponse(BaseModel):
    connected: bool


class StravaActivityMatchRequest(BaseModel):
    session: TrainingSessionIn


class StravaActivityMatchResponse(BaseModel):
    matched: bool
    activity_id: int | None = None
    title: str | None = None
    distance_km: float | None = None
    duration_min: float | None = None
    avg_pace_sec_per_km: float | None = None
    planned_distance_km: float | None = None
    planned_pace_sec_per_km: float | None = None
    average_heartrate: float | None = None
    max_heartrate: float | None = None
    elevation_gain_m: float | None = None
    felt_note: str | None = None
    plan_note: str | None = None
    gear_id: str | None = None
    gear_name: str | None = None


class StravaActivityMatchesRequest(BaseModel):
    sessions: list[TrainingSessionIn]


class StravaActivityMatchesResponse(BaseModel):
    # Keyed by each session's own ISO date (YYYY-MM-DD).
    matches: dict[str, StravaActivityMatchResponse]


class ShoeOut(BaseModel):
    id: str
    name: str
    distance_km: float
    wear_percent: float
    weeks_remaining: int | None = None
    retired: bool


class ShoesResponse(BaseModel):
    shoes: list[ShoeOut]


class RetireShoeResponse(BaseModel):
    id: str
    retired: bool


# ---- body metrics / nutrition -----------------------------------------------------------------


class BodyMetricsResponse(BaseModel):
    """The personal figures fuelling targets are scaled by.

    Every field optional, and `source` says which of Garmin's two weights answered (a
    scale reading, or the number typed into the profile years ago) so the UI can show
    its provenance instead of presenting both as the same fact.
    """

    weight_kg: float | None = None
    measured_on: date_type | None = None
    source: str | None = None  # "scale" | "profile"
    height_cm: float | None = None
    birth_date: date_type | None = None
    gender: str | None = None


class EnergyCheckOut(BaseModel):
    """What the day costs against what the targets provide.

    On the wire, and on screen, because it is the figure that makes a carbohydrate
    number checkable -- see `nutrition.EnergyCheck`.
    """

    need_kcal: int | None = None
    resting_kcal: int | None = None
    training_kcal: int
    target_kcal: tuple[int, int]
    trimmed: bool

    @classmethod
    def from_model(cls, energy: "nutrition.EnergyCheck | None") -> "EnergyCheckOut | None":
        if energy is None:
            return None
        return cls(
            need_kcal=energy.need_kcal,
            resting_kcal=energy.resting_kcal,
            training_kcal=energy.training_kcal,
            target_kcal=energy.target_kcal,
            trimmed=energy.trimmed,
        )


class DayTargetOut(BaseModel):
    date: date_type
    session_title: str | None = None
    load: str  # nutrition.SessionLoad
    duration_minutes: float | None = None
    carb_g_per_kg: tuple[float, float]
    protein_g_per_kg: tuple[float, float]
    fat_g_per_kg: tuple[float, float]
    carb_g: tuple[int, int] | None = None
    protein_g: tuple[int, int] | None = None
    fat_g: tuple[int, int] | None = None
    sport: str | None = None
    energy: EnergyCheckOut | None = None

    @classmethod
    def from_model(cls, target: "nutrition.DayTarget") -> "DayTargetOut":
        return cls(
            date=target.date,
            session_title=target.session_title,
            load=target.load,
            duration_minutes=target.duration_minutes,
            carb_g_per_kg=target.carb_g_per_kg,
            protein_g_per_kg=target.protein_g_per_kg,
            fat_g_per_kg=target.fat_g_per_kg,
            carb_g=target.carb_g,
            protein_g=target.protein_g,
            fat_g=target.fat_g,
            sport=target.sport,
            energy=EnergyCheckOut.from_model(target.energy),
        )


class PortionOut(BaseModel):
    food: str
    grams: int | None = None
    note: str | None = None

    @classmethod
    def from_model(cls, portion: "nutrition.Portion") -> "PortionOut":
        return cls(food=portion.food, grams=portion.grams, note=portion.note)


class MealSlotOut(BaseModel):
    key: str
    name: str
    timing: str
    carb_g: int
    protein_g: int
    portions: list[PortionOut] = Field(default_factory=list)
    note: str | None = None

    @classmethod
    def from_model(cls, slot: "nutrition.MealSlot") -> "MealSlotOut":
        return cls(
            key=slot.key,
            name=slot.name,
            timing=slot.timing,
            carb_g=slot.carb_g,
            protein_g=slot.protein_g,
            portions=[PortionOut.from_model(p) for p in slot.portions],
            note=slot.note,
        )


class DuringSessionOut(BaseModel):
    carb_g_per_hour: tuple[int, int]
    total_carb_g: tuple[int, int]
    note: str

    @classmethod
    def from_model(cls, during: "nutrition.DuringSession | None") -> "DuringSessionOut | None":
        if during is None:
            return None
        return cls(
            carb_g_per_hour=during.carb_g_per_hour, total_carb_g=during.total_carb_g, note=during.note
        )


class RecoveryWindowOut(BaseModel):
    carb_g: int
    protein_g: int
    note: str
    portions: list[PortionOut] = Field(default_factory=list)

    @classmethod
    def from_model(cls, window: "nutrition.RecoveryWindow | None") -> "RecoveryWindowOut | None":
        if window is None:
            return None
        return cls(
            carb_g=window.carb_g,
            protein_g=window.protein_g,
            note=window.note,
            portions=[PortionOut.from_model(p) for p in window.portions],
        )


class FuelTargetsRequest(BaseModel):
    """The plan travels with the request, as it does for /body/conflict: the file lives
    on the device and the server has no copy of it.

    `sessions` is the whole plan rather than just today's and tomorrow's, because the
    back-to-back rule needs to see the day after tomorrow too -- and because filtering
    client-side would put a rule that changes targets on the wrong side of the wire.
    """

    date: date_type | None = None
    sessions: list[TrainingSessionIn] = Field(default_factory=list)
    # A weight typed in by the user wins over Garmin's. Omitted means "ask Garmin".
    weight_kg: float | None = None


class FuelTargetsResponse(BaseModel):
    date: date_type
    weight_kg: float | None = None
    weight_source: str | None = None  # "scale" | "profile" | "manual" | "reference"
    today: DayTargetOut
    tomorrow: DayTargetOut
    advice: str
    # How today's numbers become actual plates. Empty only when there is no weight to
    # size one by.
    meals: list[MealSlotOut] = Field(default_factory=list)
    during: DuringSessionOut | None = None
    recovery: RecoveryWindowOut | None = None
    # The model's sentence is fetched separately (/nutrition/narrative) so this response
    # stays instant; it is null here by construction, never "not yet loaded".
    narrative: str | None = None

    @classmethod
    def from_model(cls, fuelling: "nutrition.DailyFuelling") -> "FuelTargetsResponse":
        return cls(
            date=fuelling.date,
            weight_kg=fuelling.weight_kg,
            weight_source=fuelling.weight_source,
            today=DayTargetOut.from_model(fuelling.today),
            tomorrow=DayTargetOut.from_model(fuelling.tomorrow),
            advice=fuelling.advice,
            meals=[MealSlotOut.from_model(m) for m in fuelling.meals],
            during=DuringSessionOut.from_model(fuelling.during),
            recovery=RecoveryWindowOut.from_model(fuelling.recovery),
        )


class NarrativeResponse(BaseModel):
    text: str
    # "model" or "template". Not for display -- the screen must read the same either way
    # -- but the difference matters when debugging why a sentence is dull.
    source: str


class FoodEntryOut(BaseModel):
    id: int
    date: date_type
    logged_at: datetime
    source: str
    description: str | None = None
    kcal: float | None = None
    carb_g: float | None = None
    protein_g: float | None = None
    fat_g: float | None = None
    confidence: str | None = None
    corrected: bool = False
    # Null unless a low-quality thumbnail was saved alongside this entry -- the full
    # photo is never written to disk (see `db.py`), only the small client-compressed
    # copy used for the meal-list icon. A `data:` URI, not a link: every route requires
    # a bearer token (`api/auth.py`), which a plain `<img src>` has no way to attach, so
    # the bytes ride along in this same JSON response instead of a fetch-by-id endpoint.
    image_url: str | None = None

    @classmethod
    def from_model(cls, entry: "db.FoodEntry") -> "FoodEntryOut":
        return cls(
            id=entry.id,
            date=entry.date,
            logged_at=entry.logged_at,
            source=entry.source,
            description=entry.description,
            kcal=entry.kcal,
            carb_g=entry.carb_g,
            protein_g=entry.protein_g,
            fat_g=entry.fat_g,
            confidence=entry.confidence,
            corrected=entry.corrected,
            image_url=(
                f"data:image/jpeg;base64,{base64.b64encode(entry.thumbnail).decode('ascii')}"
                if entry.thumbnail
                else None
            ),
        )


class DayTotals(BaseModel):
    kcal: float = 0
    carb_g: float = 0
    protein_g: float = 0
    fat_g: float = 0
    entries: int = 0


class FoodDayResponse(BaseModel):
    date: date_type
    entries: list[FoodEntryOut] = Field(default_factory=list)
    totals: DayTotals


class DayTotalsOut(DayTotals):
    date: date_type


class FoodHistoryResponse(BaseModel):
    days: list[DayTotalsOut] = Field(default_factory=list)


class ManualEntryRequest(BaseModel):
    """Logging a meal without a photo -- the way out when the model is unavailable, the
    photo is unreadable, or the user simply knows what they ate."""

    date: date_type
    description: str | None = None
    kcal: float | None = None
    carb_g: float | None = None
    protein_g: float | None = None
    fat_g: float | None = None


class DescribeMealRequest(BaseModel):
    """A meal typed out instead of photographed. The text is the whole input: the model
    turns it into the same `MacroEstimate` shape a photo produces, so both paths land in
    the same review screen and the same row."""

    date: date_type
    text: str = Field(min_length=2, max_length=400)


class FoodEntriesResponse(BaseModel):
    """Every entry in a range, for the meal diary. Flat and newest-first: the client
    groups by `date`, which it has to do anyway to print day headings."""

    entries: list[FoodEntryOut] = Field(default_factory=list)


class EntryPatchRequest(BaseModel):
    """A correction. Every field optional: an untouched field keeps its estimate, and
    sending any of them marks the entry as corrected by the user."""

    description: str | None = None
    kcal: float | None = None
    carb_g: float | None = None
    protein_g: float | None = None
    fat_g: float | None = None


class DeleteEntryResponse(BaseModel):
    deleted: bool


class NutritionConfigResponse(BaseModel):
    """What the client needs to pick between the working and the degraded states --
    and, for the photo path, to tell the user plainly that a plate photo leaves the
    machine before they take one."""

    configured: bool
    text_model: str
    vision_model: str
    photo_upload_enabled: bool


# ---- coach / technique ----------------------------------------------------------------------


class FormMetricOut(BaseModel):
    key: str
    label: str
    value: float
    unit: str
    display: str
    verdict: str
    reference: str
    meaning: str
    cue: str | None = None

    @classmethod
    def from_model(cls, metric: "technique.FormMetric") -> "FormMetricOut":
        return cls(
            key=metric.key,
            label=metric.label,
            value=metric.value,
            unit=metric.unit,
            display=metric.display,
            verdict=metric.verdict,
            reference=metric.reference,
            meaning=metric.meaning,
            cue=metric.cue,
        )


class PacingReadOut(BaseModel):
    kind: str
    first_half_pace_sec_per_km: float | None = None
    second_half_pace_sec_per_km: float | None = None
    drift_percent: float | None = None
    detail: str
    verdict: str

    @classmethod
    def from_model(cls, pacing: "technique.PacingRead | None") -> "PacingReadOut | None":
        if pacing is None:
            return None
        return cls(
            kind=pacing.kind,
            first_half_pace_sec_per_km=pacing.first_half_pace_sec_per_km,
            second_half_pace_sec_per_km=pacing.second_half_pace_sec_per_km,
            drift_percent=pacing.drift_percent,
            detail=pacing.detail,
            verdict=pacing.verdict,
        )


class ActivityFormResponse(BaseModel):
    activity_id: int
    date: date_type
    sport: str
    title: str
    distance_km: float | None = None
    duration_min: float | None = None
    average_pace_sec_per_km: float | None = None
    average_heart_rate: int | None = None
    metrics: list[FormMetricOut] = Field(default_factory=list)
    pacing: PacingReadOut | None = None
    headline: str
    focus: str | None = None
    has_metrics: bool

    @classmethod
    def from_model(cls, form: "technique.ActivityForm") -> "ActivityFormResponse":
        return cls(
            activity_id=form.activity_id,
            date=form.date,
            sport=form.sport,
            title=form.title,
            distance_km=form.distance_km,
            duration_min=form.duration_min,
            average_pace_sec_per_km=form.average_pace_sec_per_km,
            average_heart_rate=form.average_heart_rate,
            metrics=[FormMetricOut.from_model(m) for m in form.metrics],
            pacing=PacingReadOut.from_model(form.pacing),
            headline=form.headline,
            focus=form.focus,
            has_metrics=form.has_metrics,
        )


class TrendPointOut(BaseModel):
    date: date_type
    value: float


class MetricTrendOut(BaseModel):
    key: str
    label: str
    unit: str
    points: list[TrendPointOut]
    current: float
    baseline: float
    delta: float
    delta_percent: float
    direction: str
    detail: str

    @classmethod
    def from_model(cls, trend: "technique.MetricTrend") -> "MetricTrendOut":
        return cls(
            key=trend.key,
            label=trend.label,
            unit=trend.unit,
            points=[TrendPointOut(date=p.date, value=p.value) for p in trend.points],
            current=trend.current,
            baseline=trend.baseline,
            delta=trend.delta,
            delta_percent=trend.delta_percent,
            direction=trend.direction,
            detail=trend.detail,
        )


class CoachTrendRequest(BaseModel):
    """The activities to follow, newest first.

    The ids travel in the request rather than being re-derived server-side for the same
    reason the plan does on `/nutrition/targets`: the client already has the activity
    list on screen, and having the server list them again would mean two sources of
    truth for which sessions the trend covers.
    """

    activity_ids: list[int] = Field(default_factory=list)


class CoachTrendResponse(BaseModel):
    sessions_read: int
    trends: list[MetricTrendOut] = Field(default_factory=list)


# ---- planned against executed ------------------------------------------------------------


class ExecutionRequest(BaseModel):
    """The sessions to check, with their steps.

    The whole block travels, not a date range: the intent of each session comes from its
    own steps (`nutrition.classify_load`), and the server holds no copy of the plan.
    """

    sessions: list[TrainingSessionIn] = Field(default_factory=list)

    def date_key(self) -> str:
        days = sorted(s.date.isoformat() for s in self.sessions)
        return f"{days[0]}:{days[-1]}" if days else "vuoto"


class ZonesOut(BaseModel):
    threshold_hr: int
    aerobic_hr: int
    source: str
    describe: str

    @classmethod
    def from_model(cls, zones: "intensity.Zones") -> "ZonesOut":
        return cls(
            threshold_hr=zones.threshold_hr,
            aerobic_hr=zones.aerobic_hr,
            source=zones.source,
            describe=zones.describe(),
        )


class TimeInZoneOut(BaseModel):
    easy_seconds: int
    grey_seconds: int
    hard_seconds: int

    @classmethod
    def from_model(cls, zones: "intensity.TimeInZone") -> "TimeInZoneOut":
        return cls(
            easy_seconds=zones.easy_seconds, grey_seconds=zones.grey_seconds, hard_seconds=zones.hard_seconds
        )


class SessionExecutionOut(BaseModel):
    activity_id: int
    date: date_type
    title: str
    intent: str
    zones: TimeInZoneOut
    honoured: bool | None = None
    detail: str

    @classmethod
    def from_model(cls, execution: "intensity.SessionExecution") -> "SessionExecutionOut":
        return cls(
            activity_id=execution.activity_id,
            date=execution.date,
            title=execution.title,
            intent=execution.intent,
            zones=TimeInZoneOut.from_model(execution.zones),
            honoured=execution.honoured,
            detail=execution.detail,
        )


class FindingOut(BaseModel):
    key: str
    headline: str
    measured: str
    evidence: str
    standard: str | None = None
    action: str | None = None
    severity: str

    @classmethod
    def from_model(cls, finding: "intensity.Finding") -> "FindingOut":
        return cls(
            key=finding.key,
            headline=finding.headline,
            measured=finding.measured,
            evidence=finding.evidence,
            standard=finding.standard,
            action=finding.action,
            severity=finding.severity,
        )


class BlockDistributionOut(BaseModel):
    sessions: int
    from_date: date_type
    to_date: date_type
    zones: TimeInZoneOut
    easy_share: float
    grey_share: float
    hard_share: float
    easy_planned: int
    easy_honoured: int
    findings: list[FindingOut] = Field(default_factory=list)

    @classmethod
    def from_model(cls, block: "intensity.BlockDistribution") -> "BlockDistributionOut":
        return cls(
            sessions=block.sessions,
            from_date=block.from_date,
            to_date=block.to_date,
            zones=TimeInZoneOut.from_model(block.zones),
            easy_share=block.easy_share,
            grey_share=block.grey_share,
            hard_share=block.hard_share,
            easy_planned=block.easy_planned,
            easy_honoured=block.easy_honoured,
            findings=[FindingOut.from_model(f) for f in block.findings],
        )


class ExecutionBlockResponse(BaseModel):
    """Null `zones` means there is no lactate-threshold estimate to anchor on, which the
    screen reports rather than papering over with an age formula."""

    zones: ZonesOut | None = None
    block: BlockDistributionOut | None = None
    sessions: list[SessionExecutionOut] = Field(default_factory=list)

    @classmethod
    def from_models(
        cls,
        zones: "intensity.Zones | None",
        block: "intensity.BlockDistribution | None",
        executions: list["intensity.SessionExecution"],
    ) -> "ExecutionBlockResponse":
        return cls(
            zones=ZonesOut.from_model(zones) if zones else None,
            block=BlockDistributionOut.from_model(block) if block else None,
            sessions=[SessionExecutionOut.from_model(e) for e in executions],
        )


# ---- the coach plan ------------------------------------------------------------------------


class PaceEstimateOut(BaseModel):
    heart_rate: int
    sec_per_km: int
    slower_sec_per_km: int
    faster_sec_per_km: int
    samples: int

    @classmethod
    def from_model(cls, estimate: "paces.PaceEstimate | None") -> "PaceEstimateOut | None":
        if estimate is None:
            return None
        return cls(
            heart_rate=estimate.heart_rate,
            sec_per_km=estimate.sec_per_km,
            slower_sec_per_km=estimate.slower_sec_per_km,
            faster_sec_per_km=estimate.faster_sec_per_km,
            samples=estimate.samples,
        )


class PaceProfileOut(BaseModel):
    """The paces measured out of this athlete's own streams, with the sample count that
    backs each -- a pace from four hundred samples and one from eighty thousand are not
    the same claim."""

    easy: PaceEstimateOut | None = None
    threshold: PaceEstimateOut | None = None


class PrescriptionOut(BaseModel):
    key: str
    title: str
    rationale: str
    expected: str
    evidence: str
    heart_rate_cap: int | None = None
    priority: int
    session: TrainingSessionOut

    @classmethod
    def from_model(cls, item: "prescription.Prescription") -> "PrescriptionOut":
        return cls(
            key=item.key,
            title=item.title,
            rationale=item.rationale,
            expected=item.expected,
            evidence=item.evidence,
            heart_rate_cap=item.heart_rate_cap,
            priority=item.priority,
            session=TrainingSessionOut.from_model(item.session),
        )


class SensitivityRowOut(BaseModel):
    threshold_hr: int
    aerobic_hr: int
    is_estimate: bool
    easy_share: float
    grey_share: float
    hard_share: float


class CoachPlanResponse(BaseModel):
    """Null `zones` means no lactate-threshold estimate to anchor on; null `block` means
    the threshold is there but no running with a heart-rate stream is."""

    zones: ZonesOut | None = None
    block: BlockDistributionOut | None = None
    profile: PaceProfileOut | None = None
    prescriptions: list[PrescriptionOut] = Field(default_factory=list)
    sensitivity: list[SensitivityRowOut] = Field(default_factory=list)

    @classmethod
    def from_model(cls, plan: "prescription.CoachPlan") -> "CoachPlanResponse":
        return cls(
            zones=ZonesOut.from_model(plan.zones),
            block=BlockDistributionOut.from_model(plan.block),
            profile=PaceProfileOut(
                easy=PaceEstimateOut.from_model(plan.profile.easy),
                threshold=PaceEstimateOut.from_model(plan.profile.threshold),
            ),
            prescriptions=[PrescriptionOut.from_model(p) for p in plan.prescriptions],
            sensitivity=[SensitivityRowOut(**row) for row in plan.sensitivity],
        )


# ---- errors -----------------------------------------------------------------------------------


# ---- history sync ----------------------------------------------------------------------------


class HistorySyncResponse(BaseModel):
    """Whether this request started a sync. `started: false` is the normal answer: one
    is already running, or the last one was recent enough."""

    started: bool
    mode: str | None = None


class ErrorResponse(BaseModel):
    category: str  # "validation_failed" | "auth_failed" | "rate_limited" | "mfa_required"
    message: str
    details: list[str] = Field(default_factory=list)
    retry_after_seconds: int | None = None
