// Mirrors training_plan/api/schemas.py field-for-field. Keep in sync by hand until/
// unless the backend starts generating an OpenAPI client.

export type Sport = "running" | "cycling" | "swimming" | "strength_training" | "other";
export type StepType = "warmup" | "interval" | "recovery" | "rest" | "cooldown";
export type DurationType = "time" | "distance";

export interface PaceTarget {
  slower_sec_per_km: number;
  faster_sec_per_km: number;
}

export interface Step {
  type: StepType;
  duration_type: DurationType;
  duration_value: number;
  target_pace?: PaceTarget | null;
}

/** A group of steps repeated `reps` times -- Garmin's own repeat group, kept as a
 * structure end to end (see `training_plan.models.RepeatBlock`) rather than expanded
 * into look-alike steps. One level deep: `steps` never holds another block. */
export interface RepeatBlock {
  reps: number;
  steps: Step[];
}

/** What a session's `steps` may hold: plain steps, repeat blocks, or a mix. */
export type SessionStep = Step | RepeatBlock;

export function isRepeatBlock(item: SessionStep): item is RepeatBlock {
  return "reps" in item;
}

/** Every step in execution order, with blocks expanded -- for the consumers that only
 * want totals (distance rings, planned summaries) and not the grouping. Mirrors
 * `training_plan.models.flatten_steps`; the steps are shared, not copied. */
export function flattenSteps(steps: SessionStep[]): Step[] {
  return steps.flatMap((item) =>
    isRepeatBlock(item) ? Array.from({ length: item.reps }, () => item.steps).flat() : [item]
  );
}

export interface TrainingSession {
  date: string; // YYYY-MM-DD
  sport: Sport;
  title: string;
  description?: string | null;
  steps: SessionStep[];
}

export interface ScheduledWorkout {
  scheduled_workout_id: number;
  workout_id: number;
  date: string;
  sport: string;
  title: string;
}

export interface CompletedActivity {
  activity_id: number;
  date: string;
  sport: string;
  title: string;
  distance_km: number | null;
  duration_min: number | null;
}

export interface ChangedSession {
  session: TrainingSession;
  workout: ScheduledWorkout;
  local_hash: string;
  remote_hash: string;
}

export interface PlanDiff {
  to_create: TrainingSession[];
  already_present: TrainingSession[];
  extra_on_garmin: ScheduledWorkout[];
  changed: ChangedSession[];
  content_checked: boolean;
}

export interface SyncItemResult {
  date: string;
  sport: string;
  title: string;
  kind: "create" | "replace";
  status: "pending" | "ok" | "failed";
  error?: string | null;
}

export interface SyncJobStatus {
  job_id: string;
  total: number;
  completed: number;
  status: "running" | "done" | "cancelled" | "failed";
  cancel_requested: boolean;
  items: SyncItemResult[];
  failure?: string | null;
  failure_category?: "auth_failed" | "rate_limited" | null;
}

export interface GarminStatus {
  connected: boolean;
  cooldown_active: boolean;
  retry_after_seconds: number;
  reason?: string | null;
  session_expires_in_days: number | null;
}

export interface DeviceInfo {
  device_name: string | null;
  last_synced_at: string | null;
}

export interface DeleteResult {
  workout: ScheduledWorkout;
  success: boolean;
  error?: string | null;
}

export interface SleepPhases {
  deep_minutes: number | null;
  light_minutes: number | null;
  rem_minutes: number | null;
  awake_minutes: number | null;
  total_minutes: number | null;
}

export interface HrvPoint {
  date: string;
  value_ms: number | null;
}

export interface BodySnapshot {
  date: string;
  has_overnight_data: boolean;
  readiness_score: number | null;
  readiness_message: string | null;
  sleep: SleepPhases | null;
  hrv_last_night_ms: number | null;
  hrv_seven_day: HrvPoint[];
  resting_heart_rate: number | null;
  resting_heart_rate_delta: number | null;
  battery_percent: number | null;
  stress_level: number | null;
}

export interface WeeklyLoad {
  week_start: string;
  completed_load: number | null;
  in_progress: boolean;
}

export interface LoadSnapshot {
  weeks: WeeklyLoad[];
  acute_chronic_ratio: number | null;
  vo2max: number | null;
}

export interface ConflictOption {
  kind: "reschedule" | "soften";
  label: string;
  detail: string;
}

export interface ConflictAssessment {
  has_conflict: boolean;
  signals: string[];
  options: ConflictOption[];
}

export interface StravaStatus {
  connected: boolean;
}

export interface StravaActivityMatch {
  matched: boolean;
  activity_id?: number | null;
  title?: string | null;
  distance_km?: number | null;
  duration_min?: number | null;
  avg_pace_sec_per_km?: number | null;
  planned_distance_km?: number | null;
  planned_pace_sec_per_km?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  elevation_gain_m?: number | null;
  felt_note?: string | null;
  plan_note?: string | null;
  gear_id?: string | null;
  gear_name?: string | null;
}

export interface Shoe {
  id: string;
  name: string;
  distance_km: number;
  wear_percent: number;
  weeks_remaining: number | null;
  retired: boolean;
}

export interface ApiErrorBody {
  category: "validation_failed" | "auth_failed" | "rate_limited" | "mfa_required" | "server_error";
  message: string;
  details: string[];
  retry_after_seconds?: number | null;
}
