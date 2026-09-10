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

/** The race a plan is written for. Optional everywhere: `goal` is null for the many
 * plans that state none, and every screen that reads it renders without it.
 *
 * `phase` and `days_to_race` are computed server-side from `race_date` (see
 * `models.race_phase`) rather than here -- one implementation, so a countdown and a
 * phase label can never disagree between two screens. */
export interface RaceGoal {
  race_date: string; // YYYY-MM-DD
  distance_km: number;
  name: string | null;
  target_time_seconds: number | null;
  // Both derived from `race_date` server-side, so they are absent for the moment
  // between setting a goal in the app and the server answering (see `useSetRaceGoal`).
  // The countdown is recomputed locally anyway (`raceGoal.ts`); the phase label is the
  // one thing that waits, and every screen renders without it.
  phase?: "base" | "costruzione" | "picco" | "scarico" | "gara passata";
  days_to_race?: number;
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

export interface RescheduleResult {
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

/** One comparison between the plan and the race, carrying both numbers -- "il più lungo
 * in programma è 24 km, per questa distanza se ne fanno almeno 30". */
export interface GoalObservation {
  key: string;
  label: string;
  detail: string;
  severity: "ok" | "attenzione" | "sconosciuto";
}

export interface GoalWeekVolume {
  week_start: string;
  km: number;
  sessions: number;
}

/** How the sessions already in the plan line up with the race, computed by
 * `training_plan/goal_fit.py` from the plan file alone. `longest_run_km` and
 * `peak_week_km` are null when the sessions carry no steps (a Garmin calendar), which
 * is a "I can't see that" and never a zero. */
export interface GoalFit {
  race_date: string;
  days_to_race: number;
  phase: string;
  alignment: "in linea" | "da guardare" | "non arriva" | "non valutabile";
  headline: string;
  observations: GoalObservation[];
  sessions_ahead: number;
  weeks_covered: number;
  last_session_date: string | null;
  longest_run_km: number | null;
  longest_run_date: string | null;
  longest_run_guide_km: number | null;
  peak_week_km: number | null;
  weekly_volume: GoalWeekVolume[];
  quality_sessions: number;
  sessions_without_detail: number;
}

/** One measurement that moved today's verdict, with the figure that did it. */
export interface DaySignal {
  key: string;
  label: string;
  detail: string;
  severity: "info" | "moderato" | "forte";
}

export interface DayAlternative {
  kind: "soften" | "reschedule" | "rest" | "easy";
  label: string;
  detail: string;
}

/** How the body reads this morning, and what that means for today's session.
 *
 * Everything here is computed by `training_plan/readiness.py` from thresholds the user
 * can check against their own watch -- see that module's docstring. `state` is
 * "sconosciuto" (and `has_data` false) whenever there is no overnight reading, which is
 * a blank, not a verdict. */
export interface DayVerdict {
  date: string;
  state: "pronto" | "cauto" | "scarico" | "sconosciuto";
  headline: string;
  signals: DaySignal[];
  session_title: string | null;
  session_demand: "riposo" | "facile" | "medio" | "duro" | null;
  action: "conferma" | "alleggerisci" | "sposta" | "riposa" | null;
  alternative: DayAlternative | null;
  phase: string | null;
  has_data: boolean;
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

/** Name + avatar of a connected account, from /strava/athlete or /garmin/profile.
 * Both fields are optional on purpose: an account with no photo is normal. */
export interface AthleteProfile {
  name: string | null;
  image_url: string | null;
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

// ---- body metrics + fuelling (nutrition) --------------------------------------------------

/** Garmin's view of the user's body -- weight, height, age. Every field optional: a
 * missing Garmin session degrades to an empty object, never a 401 (see
 * `body_metrics_or_empty`). `source` says which of Garmin's two weights answered. */
export interface BodyMetrics {
  weight_kg: number | null;
  measured_on: string | null;
  source: "scale" | "profile" | null;
  height_cm: number | null;
  birth_date: string | null;
  gender: string | null;
}

export type SessionLoad = "riposo" | "facile" | "moderato" | "duro" | "molto_lungo";

export interface DayTarget {
  date: string;
  session_title: string | null;
  load: SessionLoad;
  duration_minutes: number | null;
  carb_g_per_kg: [number, number];
  protein_g_per_kg: [number, number];
  fat_g_per_kg: [number, number];
  carb_g: [number, number] | null;
  protein_g: [number, number] | null;
  fat_g: [number, number] | null;
}

export interface FuelTargets {
  date: string;
  weight_kg: number | null;
  weight_source: "scale" | "profile" | "manual" | "reference" | null;
  today: DayTarget;
  tomorrow: DayTarget;
  advice: string;
  // Fetched separately (/nutrition/narrative) -- always null on the targets response.
  narrative: string | null;
}

export interface Narrative {
  text: string;
  source: "model" | "template";
}

export type FoodConfidence = "low" | "medium" | "high";

export interface FoodEntry {
  id: number;
  date: string;
  logged_at: string;
  // "text": typed out and read by the model -- an estimate like a photo's, not a number
  // the user stated (that is "manual", and arrives already `corrected`).
  source: "photo" | "manual" | "text";
  description: string | null;
  kcal: number | null;
  carb_g: number | null;
  protein_g: number | null;
  fat_g: number | null;
  confidence: FoodConfidence | null;
  corrected: boolean;
  // Relative to API_BASE_URL, e.g. "/nutrition/entry/12/photo" -- never a filesystem path.
  image_url: string | null;
}

export interface DayTotals {
  kcal: number;
  carb_g: number;
  protein_g: number;
  fat_g: number;
  entries: number;
}

export interface FoodDay {
  date: string;
  entries: FoodEntry[];
  totals: DayTotals;
}

export interface DayTotalsForDate extends DayTotals {
  date: string;
}

export interface FoodHistory {
  days: DayTotalsForDate[];
}

/** Every entry over a window, newest first -- what the meal diary reads. */
export interface FoodEntries {
  entries: FoodEntry[];
}

export interface NutritionConfig {
  configured: boolean;
  text_model: string;
  vision_model: string;
  photo_upload_enabled: boolean;
}

export interface ApiErrorBody {
  category: "validation_failed" | "auth_failed" | "rate_limited" | "mfa_required" | "server_error";
  message: string;
  details: string[];
  retry_after_seconds?: number | null;
}
