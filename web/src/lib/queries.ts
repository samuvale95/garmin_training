"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { keepPreviousData, useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostForm, apiPut } from "./apiClient";
import { shiftDateKey, toDateKey, weekBounds } from "./sessionVisuals";
import type {
  AthleteProfile,
  BodyMetrics,
  BodySnapshot,
  CompletedActivity,
  ConflictAssessment,
  DayVerdict,
  DeleteResult,
  DeviceInfo,
  FoodDay,
  FoodEntries,
  FoodEntry,
  FoodHistory,
  FuelTargets,
  GarminStatus,
  LoadSnapshot,
  Narrative,
  PlanDiff,
  RaceGoal,
  RescheduleResult,
  ScheduledWorkout,
  Shoe,
  StravaActivityMatch,
  StravaStatus,
  SyncJobStatus,
  TrainingSession,
} from "./types";

// ---- how long an answer stays good --------------------------------------------------------

/** The default for anything that tracks "now": five minutes, matching the QueryClient's
 * own default (providers.tsx). */
const LIVE_STALE_TIME = 5 * 60_000;

/** ...and the rule for everything that doesn't.
 *
 * A date range that has already ended cannot change on its own: a completed activity is
 * a fact, and Garmin's calendar for a past week only ever changes because *this app*
 * wrote to it -- which invalidates the `garmin` keys outright (see `useRescheduleWorkout`,
 * `useApplyDeletion`, the sync job) and so overrides any staleTime set here. Paging back
 * to a week already looked at therefore costs nothing, however long ago it was looked
 * at, instead of re-paying a Garmin round-trip every five minutes. `useRefreshServerData`
 * remains the "ask again anyway" escape hatch, and invalidation ignores staleness too.
 *
 * The day of margin is for timezones: this device may be a day ahead of the server that
 * answers, and a range that is still "today" for anyone involved must not be frozen. */
const PAST_RANGE_MARGIN_DAYS = 1;

function isPastDate(dateKey: string): boolean {
  return dateKey < shiftDateKey(toDateKey(new Date()), -PAST_RANGE_MARGIN_DAYS);
}

/** `Infinity` for a range that has ended, the live default otherwise. */
function rangeStaleTime(end: string): number {
  return isPastDate(end) ? Infinity : LIVE_STALE_TIME;
}

// ---- plan / sessions (server-backed, mirrored to localStorage -- see usePlanQuery below) ---

/** The plan's own cache key. Deliberately *not* `["plan", ...]`-prefixed: the diff and
 * the sync job used to share that prefix, so any `invalidateQueries({queryKey:["plan"]})`
 * would have blown away the localStorage-backed plan alongside them. */
const PLAN_KEY = ["plan-state"] as const;

const PLAN_STORAGE_KEY = "passo-plan";
/** Zustand's old `persist` key (store.ts) that used to hold `plan` alongside prefs/
 * profile/etc, wrapped as `{state: {...}, version}`. Read as a one-time migration
 * fallback so a plan imported before this move to TanStack Query isn't orphaned. */
const LEGACY_STORAGE_KEY = "passo-device-state";

export interface PlanState {
  yamlText: string;
  sessions: TrainingSession[];
  filename: string | null;
  importedAt: string | null;
  /** The race this plan is written for, when it states one (see `RaceGoal`). */
  goal?: RaceGoal | null;
}

function readLegacyPlan(): PlanState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? "null");
    return raw?.state?.plan ?? null;
  } catch {
    return null;
  }
}

function readPersistedPlan(): PlanState | null {
  if (typeof window === "undefined") return null;
  try {
    const current = JSON.parse(localStorage.getItem(PLAN_STORAGE_KEY) ?? "null");
    if (current) return current;
  } catch {
    // fall through to the legacy read below
  }
  return readLegacyPlan();
}

function persistPlan(plan: PlanState | null): void {
  if (typeof window === "undefined") return;
  if (plan) localStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
  else localStorage.removeItem(PLAN_STORAGE_KEY);
}

/** Whether the plan has been restored yet (from the server, falling back to
 * localStorage), as a tiny external store. It is a property of the browser tab, not of
 * any one component -- the first `usePlanQuery` to mount restores the plan for
 * everybody -- and keeping it outside React is also what lets `isHydrated` flip only
 * once the restore has actually landed, so nobody can ever observe `isHydrated ===
 * true` next to a plan that hasn't been restored yet. */
let planHydrated = false;
/** Set synchronously, before the `GET /plan` round-trip even starts -- unlike
 * `planHydrated`, which only flips once that call resolves. Without a separate,
 * synchronous guard, two `usePlanQuery` mounts in the same tick (Settimana's guard and
 * Oggi's, say) would each see `planHydrated === false` and both fire the request. */
let planHydrationStarted = false;
const planHydrationListeners = new Set<() => void>();

function subscribePlanHydration(onChange: () => void): () => void {
  planHydrationListeners.add(onChange);
  return () => planHydrationListeners.delete(onChange);
}

function restorePersistedPlanOnce(queryClient: ReturnType<typeof useQueryClient>): void {
  if (planHydrationStarted) return;
  planHydrationStarted = true;
  const local = readPersistedPlan();

  apiGet<{ plan: PlanState | null }>("/plan")
    .then(({ plan: remote }) => {
      if (remote) {
        // The server has a copy -- it wins over whatever this device had cached,
        // exactly the same way a second device or a cleared browser should see it.
        applyPlanLocally(queryClient, remote);
      } else if (local) {
        // Nothing server-side yet, but this device already has a plan from before the
        // move to server-backed storage (or a stretch spent offline): push it up once,
        // rather than let the switch silently orphan it.
        writePlan(queryClient, local);
      }
    })
    .catch(() => {
      // Offline, or the request failed -- fall back to whatever this device already
      // has. The next successful `writePlan` (or the next reload) reconciles with the
      // server.
      if (local) applyPlanLocally(queryClient, local);
    })
    .finally(() => {
      planHydrated = true;
      for (const listener of planHydrationListeners) listener();
    });
}

/** The active plan: server-backed (Postgres, one row per user -- see `training_plan/
 * db.py`'s `user_plan` table), with a localStorage mirror for an instant same-tab
 * paint and offline resilience. It lives in the TanStack Query cache like every other
 * piece of app data, but with no real `queryFn` (there is nothing to fetch through
 * `useQuery` itself -- the restore below drives the cache directly) -- `staleTime:
 * Infinity` keeps it from ever being silently refetched into nothing. All writes go
 * through `writePlan`, which updates the cache, mirrors to localStorage, and pushes to
 * the server in the same call.
 *
 * The restore itself happens in an effect, not in `initialData`: Next.js server-renders
 * this ("use client") page too, where neither `localStorage` nor a real session exist,
 * so seeding synchronously would make the client's first render disagree with the
 * server-rendered HTML and trigger a React hydration-mismatch (a full, jank-y
 * client-side re-render of the tree). Deferring it to `useEffect` keeps the first
 * client render identical to the server's (both start from `null`), then hydrates once
 * the restore lands -- `isHydrated` lets callers that redirect on a missing plan (see
 * guards.ts) hold off until then, so an existing plan doesn't cause a spurious bounce
 * to /import.
 */
export function usePlanQuery() {
  const queryClient = useQueryClient();
  // Server snapshot is pinned to false so the hydration render matches the server's HTML
  // even when another component restored the plan earlier in this same page load; React
  // re-renders with the real value immediately afterwards (same shape as `useMounted`).
  const isHydrated = useSyncExternalStore(
    subscribePlanHydration,
    () => planHydrated,
    () => false
  );

  useEffect(() => {
    restorePersistedPlanOnce(queryClient);
  }, [queryClient]);

  const query = useQuery({
    queryKey: PLAN_KEY,
    queryFn: (): PlanState | null => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return { ...query, isHydrated };
}

function applyPlanLocally(queryClient: ReturnType<typeof useQueryClient>, next: PlanState | null): void {
  queryClient.setQueryData<PlanState | null>(PLAN_KEY, next);
  persistPlan(next);
}

/** Best-effort: the query cache + localStorage mirror (updated synchronously, just
 * before this call) stay this tab's source of truth regardless of whether the request
 * succeeds -- a save made offline reaches the server on the next `writePlan` call, or
 * gets pushed by `restorePersistedPlanOnce`'s own migration path on the next load. */
function persistPlanToServer(queryClient: ReturnType<typeof useQueryClient>, plan: PlanState | null): void {
  const request = plan
    ? apiPut<{ goal: RaceGoal | null }>("/plan", {
        goal: plan.goal
          ? {
              // Only the stated facts travel: `phase` and `days_to_race` are derived
              // from the date, and the server recomputes them on every read.
              race_date: plan.goal.race_date,
              distance_km: plan.goal.distance_km,
              name: plan.goal.name,
              target_time_seconds: plan.goal.target_time_seconds,
            }
          : null,
        yaml_text: plan.yamlText,
        sessions: plan.sessions,
        filename: plan.filename,
        imported_at: plan.importedAt ?? new Date().toISOString(),
      })
    : apiDelete<{ ok: boolean }>("/plan");

  request
    .then((saved) => {
      // The goal comes back carrying its derived `phase` and `days_to_race`, computed
      // in the one place that owns that rule (`models.race_phase`). Adopting them here
      // is what spares this client a second implementation of it -- guarded on the race
      // date, so an answer that arrives after the user has already changed the goal
      // again is dropped rather than applied to a different race.
      if (!plan || !("goal" in saved) || !saved.goal) return;
      const current = queryClient.getQueryData<PlanState | null>(PLAN_KEY);
      if (!current?.goal || current.goal.race_date !== saved.goal.race_date) return;
      applyPlanLocally(queryClient, { ...current, goal: saved.goal });
    })
    .catch(() => {});
}

function writePlan(queryClient: ReturnType<typeof useQueryClient>, next: PlanState | null): void {
  applyPlanLocally(queryClient, next);
  persistPlanToServer(queryClient, next);
}

export function useSetPlan() {
  const queryClient = useQueryClient();
  return (plan: PlanState) => writePlan(queryClient, plan);
}

export function useClearPlan() {
  const queryClient = useQueryClient();
  return () => writePlan(queryClient, null);
}

/** Settings' "Ripristina tutto" escape hatch: wipes every piece of local app state
 * (the plan under both its current and legacy storage keys, plus every cached
 * server-derived query -- Garmin/Strava/body) so the app has nothing left to disagree
 * about with itself. Garmin/Strava *connections* are untouched (those tokens live
 * server-side, not here) -- afterwards the app simply falls back to showing the live
 * Garmin calendar directly, with nothing local left to be stale or inconsistent.
 */
export function useResetAllLocalData() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.clear();
    if (typeof window !== "undefined") {
      localStorage.removeItem(PLAN_STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      // The cache is also mirrored to localStorage across reloads (see providers.tsx);
      // clearing only the in-memory copy would let the old one come back on refresh.
      localStorage.removeItem("passo-query-cache");
    }
    // The plan now also lives server-side (see `writePlan`) -- without this, the next
    // reload's restore would pull the "deleted" plan right back down from there.
    apiDelete("/plan").catch(() => {});
  };
}

/** "Ask again, now": the user-facing refresh.
 *
 * Reads are cached on both sides -- in this client for minutes, and in the backend's own
 * TTL cache -- which is what makes moving between screens instant. Refreshing therefore
 * has to clear the server's copy first, otherwise refetching would just re-read the same
 * cached answer. Data stays on screen throughout; it's replaced when the new one lands.
 */
export function useRefreshServerData() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ cleared: boolean }>("/cache/clear"),
    onSettled: () => {
      // Everything except the local plan, which has no server side to refresh.
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== PLAN_KEY[0],
      });
    },
  });
}

/** Set or clear the race this plan is written for.
 *
 * A plan edit like any other: it goes through `writePlan`, so it lands in the cache,
 * the localStorage mirror and the server in one call, and a plan downloaded afterwards
 * carries the goal (see `serializePlanToYaml`). Editing it here rather than only in the
 * YAML matches what the app already does to sessions -- it has been writing to the plan
 * since the day the calendar let you drag one to another day. */
export function useSetRaceGoal() {
  const queryClient = useQueryClient();
  return (goal: RaceGoal | null) => {
    const current = queryClient.getQueryData<PlanState | null>(PLAN_KEY);
    if (!current) return;
    writePlan(queryClient, { ...current, goal });
  };
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return (index: number, updater: (session: TrainingSession) => TrainingSession) => {
    const current = queryClient.getQueryData<PlanState | null>(PLAN_KEY);
    if (!current || !current.sessions[index]) return;
    const sessions = [...current.sessions];
    sessions[index] = updater(sessions[index]);
    writePlan(queryClient, { ...current, sessions });
  };
}

/** Appends a new session (screen 10b, create mode) and returns its index, lazily
 * creating an empty plan if none exists yet. */
export function useAddSession() {
  const queryClient = useQueryClient();
  return (session: TrainingSession): number => {
    const current = queryClient.getQueryData<PlanState | null>(PLAN_KEY);
    const base = current ?? { yamlText: "", sessions: [], filename: null, importedAt: new Date().toISOString() };
    const sessions = [...base.sessions, session];
    writePlan(queryClient, { ...base, sessions });
    return sessions.length - 1;
  };
}

export function useRemoveSession() {
  const queryClient = useQueryClient();
  return (index: number) => {
    const current = queryClient.getQueryData<PlanState | null>(PLAN_KEY);
    if (!current) return;
    const sessions = current.sessions.filter((_, i) => i !== index);
    writePlan(queryClient, { ...current, sessions });
  };
}

// ---- garmin connection -----------------------------------------------------------------

export function useGarminStatus() {
  return useQuery({
    queryKey: ["garmin", "status"],
    queryFn: ({ signal }) => apiGet<GarminStatus>("/garmin/status", undefined, signal),
    refetchInterval: (query) => (query.state.data?.cooldown_active ? 10_000 : 30_000),
  });
}

export function useConnectGarmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { email: string; password: string; mfa_code?: string }) =>
      apiPost<{ connected: boolean }>("/garmin/connect", payload),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["garmin", "status"] });
      const previous = queryClient.getQueryData<GarminStatus>(["garmin", "status"]);
      queryClient.setQueryData<GarminStatus | undefined>(["garmin", "status"], (old) =>
        old ? { ...old, connected: true } : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(["garmin", "status"], context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["garmin", "status"] });
      // A different account may be behind this login -- the old one's name and photo
      // must not survive it.
      queryClient.invalidateQueries({ queryKey: ["garmin", "profile"] });
    },
  });
}

export function useDisconnectGarmin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ connected: boolean }>("/garmin/disconnect"),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["garmin", "status"] });
      const previous = queryClient.getQueryData<GarminStatus>(["garmin", "status"]);
      queryClient.setQueryData<GarminStatus | undefined>(["garmin", "status"], (old) =>
        old ? { ...old, connected: false } : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(["garmin", "status"], context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["garmin", "status"] });
      queryClient.invalidateQueries({ queryKey: ["garmin", "device"] });
      queryClient.invalidateQueries({ queryKey: ["garmin", "profile"] });
    },
  });
}

export function useGarminDevice(enabled = true) {
  return useQuery({
    queryKey: ["garmin", "device"],
    queryFn: ({ signal }) => apiGet<DeviceInfo>("/garmin/device", undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The Garmin account's own name/photo -- the avatar's fallback when Strava has none
 * (see `useAthleteIdentity`). Long `staleTime`: who the user is does not change while
 * they use the app, and this is read on every screen with an avatar in the corner. */
export function useGarminProfile(enabled = true) {
  return useQuery({
    queryKey: ["garmin", "profile"],
    queryFn: ({ signal }) => apiGet<AthleteProfile>("/garmin/profile", undefined, signal),
    enabled,
    staleTime: 60 * 60_000,
  });
}

// ---- plan: parse / diff -----------------------------------------------------------------

/** What `/plan/parse` answers: the sessions, and the race the file states (or null).
 * Both travel together because both come out of the same validation pass -- a file with
 * a broken `goal:` block is a rejected file, not a plan with no goal. */
export interface ParsedPlanResponse {
  sessions: TrainingSession[];
  goal: RaceGoal | null;
}

export function useParsePlanText() {
  return useMutation({
    mutationFn: (yamlText: string) => {
      const form = new FormData();
      form.set("yaml_text", yamlText);
      return apiPostForm<ParsedPlanResponse>("/plan/parse", form);
    },
  });
}

export function useParsePlanFile() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return apiPostForm<ParsedPlanResponse>("/plan/parse", form);
    },
  });
}

/** Stable, short cache key for a plan's contents.
 *
 * The plan itself used to be embedded in the query key. That works (keys are hashed
 * deterministically) but re-hashes the entire session list on every render, and any
 * edit mints a brand-new entry -- so a cheap content hash is used instead. */
function planFingerprint(sessions: TrainingSession[]): string {
  const source = JSON.stringify(sessions);
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  return `${sessions.length}:${(hash >>> 0).toString(36)}`;
}

/** The plan-vs-calendar diff, content comparison included.
 *
 * `check_content` makes the backend read every matched workout back from Garmin to
 * compare step contents -- that's what detects a session edited in place, which both Oggi
 * ("N differenze") and /diff need. It used to run with `staleTime: 0, gcTime: 0` and no
 * server-side cache, so *every* visit to Oggi re-paid a calendar read plus one Garmin
 * call per session, and bouncing Oggi -> Settimana -> Oggi paid it twice.
 *
 * Now: one shared cache entry (Oggi and /diff use the same key), those per-session calls
 * go out concurrently, and the backend caches the answer too. It can only become wrong if
 * the plan changes -- a new fingerprint, hence a new key -- or if the calendar changes,
 * which invalidates it server-side (`invalidate_calendar`). */
export function usePlanDiff(sessions: TrainingSession[] | null) {
  return useQuery({
    queryKey: ["plan-diff", sessions ? planFingerprint(sessions) : null],
    queryFn: ({ signal }) => apiPost<PlanDiff>("/plan/diff", { sessions, check_content: true }, signal),
    enabled: !!sessions && sessions.length > 0,
    // Keep showing the previous answer while a plan edit recomputes the new one,
    // instead of dropping back to "no data" (and an empty screen) in between.
    placeholderData: keepPreviousData,
  });
}

// ---- plan: sync job ----------------------------------------------------------------------

/** Drop every cached view of the Garmin calendar -- call it after a write lands.
 *
 * A sync job writes to the calendar from a *background thread*, long after the request
 * that started it returned, so no mutation's `onSettled` can stand in for this. Without
 * it the week, the workout's own step structure, and the plan diff all keep serving
 * their pre-write answers for the rest of their stale time, and the screen you land on
 * after saving shows the workout exactly as it was. */
export function useInvalidateCalendarData() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["garmin", "workouts"] });
    queryClient.invalidateQueries({ queryKey: ["garmin", "workout-session"] });
    queryClient.invalidateQueries({ queryKey: ["plan-diff"] });
  }, [queryClient]);
}

export function useStartSync() {
  return useMutation({
    mutationFn: (payload: {
      to_create: TrainingSession[];
      changed: Array<{
        session: TrainingSession;
        scheduled_workout_id: number;
        workout_id: number;
        workout_date: string;
        workout_sport: string;
        workout_title: string;
      }>;
    }) => apiPost<{ job_id: string }>("/plan/sync", payload),
  });
}

export function useSyncJobStatus(jobId: string | null) {
  return useQuery({
    queryKey: ["sync-job", jobId],
    queryFn: ({ signal }) => apiGet<SyncJobStatus>(`/plan/sync/${jobId}`, undefined, signal),
    enabled: !!jobId,
    // Poll only while the job is actually running -- once done/cancelled/failed the
    // final snapshot is written into writeJobHistory and polling stops.
    refetchInterval: (query) => (query.state.data?.status === "running" ? 500 : false),
  });
}

export function useCancelSync() {
  return useMutation({
    mutationFn: (jobId: string) => apiPost<{ ok: boolean }>(`/plan/sync/${jobId}/cancel`),
  });
}

// ---- garmin calendar / deletions ----------------------------------------------------------

/** Scheduled Garmin workouts for a date range.
 *
 * Prefer `useWeekWorkouts`/`useWorkoutsForDate` over calling this with an arbitrary
 * range: the cache is keyed by (start, end), so a single-day request is a guaranteed
 * miss against the week Oggi/Settimana already loaded -- which is exactly why opening a
 * day's detail used to trigger a fresh Garmin round-trip for data already on screen. */
/** One definition of "this range's scheduled workouts", shared by the hook and the
 * prefetch below so a warmed slot is always the one the screen goes on to read. */
function workoutsQueryOptions(start: string, end: string) {
  return {
    queryKey: ["garmin", "workouts", start, end] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      apiGet<{ workouts: ScheduledWorkout[] }>("/garmin/workouts", { start, end }, signal),
    staleTime: rangeStaleTime(end),
  };
}

export function useWorkouts(start: string, end: string, enabled = true) {
  return useQuery({
    ...workoutsQueryOptions(start, end),
    enabled,
    // Paging through weeks keeps the previous week visible until the next one lands.
    placeholderData: keepPreviousData,
  });
}

/** The calendar week containing `date` (any day in it) -- the one shape every screen
 * shares, so all of them hit the same cache entry. */
export function useWeekWorkouts(date: string | Date, enabled = true) {
  const reference = typeof date === "string" ? new Date(`${date}T00:00:00`) : date;
  const valid = !Number.isNaN(reference.getTime());
  const { start, end } = weekBounds(valid ? reference : new Date());
  return useWorkouts(toDateKey(start), toDateKey(end), enabled && valid);
}

/** Just the workouts scheduled on `date`, served from that date's cached *week*.
 *
 * Detail screens and the editor need one day, but asking for one day would cost its own
 * request; deriving it from the week they were opened from is free. */
export function useWorkoutsForDate(date: string, enabled = true) {
  const query = useWeekWorkouts(date, enabled && !!date);
  const workouts = query.data?.workouts.filter((w) => w.date === date);
  return { ...query, workouts: workouts ?? [] };
}

/** The full step structure behind a live Garmin-calendar workout (no local plan) --
 * lets `/workout/[id]` render the exact same session-detail view as an imported
 * plan's session, instead of only ever knowing date/sport/title (see
 * `ScheduledWorkout`). `workout` is the calendar entry from `useWorkouts`, whose
 * date/sport/title travel along as query params since Garmin's workout definition
 * itself carries no calendar date. */
/** One definition of "this workout's step structure", used by both the hook and the
 * prefetch below -- if the key and the fetch could drift apart, a prefetch would warm a
 * slot the screen never reads.
 *
 * The date is part of the key: the same workout definition scheduled on two days is two
 * different sessions, and keying on `workout_id` alone made the second one read the
 * first one's cached copy (wrong date, wrong "svolto" comparison). */
function workoutSessionKey(workout: ScheduledWorkout | null) {
  return ["garmin", "workout-session", workout?.workout_id ?? null, workout?.date ?? null] as const;
}

function fetchWorkoutSession(workout: ScheduledWorkout, signal?: AbortSignal) {
  return apiGet<TrainingSession>(
    `/garmin/workouts/${workout.workout_id}/session`,
    { date: workout.date, sport: workout.sport, title: workout.title },
    signal
  );
}

/** A workout's step structure only changes when it is edited here, which invalidates
 * this key -- so an hour for anything still ahead, and never for a day already run. */
function workoutSessionStaleTime(workout: ScheduledWorkout | null): number {
  if (workout && isPastDate(workout.date)) return Infinity;
  return 60 * 60_000;
}

export function useWorkoutSession(workout: ScheduledWorkout | null, enabled = true) {
  return useQuery({
    queryKey: workoutSessionKey(workout),
    queryFn: ({ signal }) => fetchWorkoutSession(workout!, signal),
    enabled: enabled && !!workout,
    staleTime: workoutSessionStaleTime(workout),
  });
}

/** Start a workout's step-structure fetch before its detail screen is even mounted.
 *
 * Used on touch-down from Settimana: the detail screen needs a Garmin read the week list
 * didn't, and starting it a few hundred milliseconds early is usually the difference
 * between arriving to content and arriving to a skeleton. */
export function usePrefetchWorkoutSession() {
  const queryClient = useQueryClient();
  return (workout: ScheduledWorkout | null) => {
    if (!workout) return;
    queryClient.prefetchQuery({
      queryKey: workoutSessionKey(workout),
      queryFn: ({ signal }) => fetchWorkoutSession(workout, signal),
      staleTime: workoutSessionStaleTime(workout),
    });
  };
}

function activitiesQueryOptions(start: string, end: string) {
  return {
    queryKey: ["garmin", "activities", start, end] as const,
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      apiGet<{ activities: CompletedActivity[] }>("/garmin/activities", { start, end }, signal),
    staleTime: rangeStaleTime(end),
  };
}

export function useActivities(start: string, end: string, enabled = true) {
  return useQuery({ ...activitiesQueryOptions(start, end), enabled });
}

/** Warms whole weeks that haven't been asked for yet -- Settimana calls it for the two
 * weeks either side of the one on screen, so paging is instant the *first* time too and
 * not only on the way back. Prefetching respects `staleTime`, so a week already in the
 * cache costs nothing here. */
export function usePrefetchWeeks(references: Date[], { workouts, activities }: { workouts: boolean; activities: boolean }) {
  const queryClient = useQueryClient();
  const ranges = references.map((reference) => {
    const { start, end } = weekBounds(reference);
    return [toDateKey(start), toDateKey(end)] as const;
  });
  // The effect must run when the *weeks* change, not on every render that rebuilt the
  // Date objects above.
  const fingerprint = ranges.map(([start, end]) => `${start}:${end}`).join("|");

  useEffect(() => {
    for (const range of fingerprint.split("|")) {
      const [start, end] = range.split(":");
      if (!start || !end) continue;
      if (workouts) queryClient.prefetchQuery(workoutsQueryOptions(start, end));
      if (activities) queryClient.prefetchQuery(activitiesQueryOptions(start, end));
    }
  }, [fingerprint, workouts, activities, queryClient]);
}

export function useDeletionPreview() {
  return useMutation({
    mutationFn: (payload: { start: string; end: string; sport?: string; title_match?: string }) =>
      apiPost<{ selected: ScheduledWorkout[] }>("/garmin/deletions/preview", payload),
  });
}

export function useApplyDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workouts: ScheduledWorkout[]) =>
      apiPost<{ results: DeleteResult[] }>("/garmin/deletions/apply", { workouts }),
    onMutate: async (workouts) => {
      const deletedIds = new Set(workouts.map((w) => w.scheduled_workout_id));
      await queryClient.cancelQueries({ queryKey: ["garmin", "workouts"] });
      const previous = queryClient.getQueriesData<{ workouts: ScheduledWorkout[] }>({ queryKey: ["garmin", "workouts"] });
      queryClient.setQueriesData<{ workouts: ScheduledWorkout[] } | undefined>({ queryKey: ["garmin", "workouts"] }, (old) =>
        old ? { workouts: old.workouts.filter((w) => !deletedIds.has(w.scheduled_workout_id)) } : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["garmin", "workouts"] });
    },
  });
}

/** Drags a live Garmin calendar entry onto a different day (Settimana). Optimistic,
 * same shape as `useApplyDeletion` above: the card has to jump to its new day
 * immediately, not wait a round-trip for Garmin to confirm the move. */
export function useRescheduleWorkout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workout, newDate }: { workout: ScheduledWorkout; newDate: string }) =>
      apiPost<RescheduleResult>("/garmin/workouts/reschedule", { workout, new_date: newDate }),
    onMutate: async ({ workout, newDate }) => {
      await queryClient.cancelQueries({ queryKey: ["garmin", "workouts"] });
      const previous = queryClient.getQueriesData<{ workouts: ScheduledWorkout[] }>({ queryKey: ["garmin", "workouts"] });
      queryClient.setQueriesData<{ workouts: ScheduledWorkout[] } | undefined>({ queryKey: ["garmin", "workouts"] }, (old) =>
        old
          ? {
              workouts: old.workouts.map((w) =>
                w.scheduled_workout_id === workout.scheduled_workout_id ? { ...w, date: newDate } : w
              ),
            }
          : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["garmin", "workouts"] });
      queryClient.invalidateQueries({ queryKey: ["garmin", "workout-session"] });
    },
  });
}

// ---- body insights (read-only) -------------------------------------------------------------

export function useBodyToday() {
  return useQuery({
    queryKey: ["body", "today"],
    queryFn: ({ signal }) => apiGet<BodySnapshot>("/body/today", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useBodyLoad() {
  return useQuery({
    queryKey: ["body", "load"],
    queryFn: ({ signal }) => apiGet<LoadSnapshot>("/body/load", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

/** Today's state, and what it means for today's session.
 *
 * The session and the goal travel in the request because the plan lives on the device.
 * Keyed on both, so editing the plan (or the race) recomputes rather than serving a
 * verdict about a session that is no longer today's. */
export function useDayVerdict(session: TrainingSession | null, goal: RaceGoal | null | undefined, enabled = true) {
  const goalPayload = goal
    ? { race_date: goal.race_date, distance_km: goal.distance_km, name: goal.name, target_time_seconds: goal.target_time_seconds }
    : null;
  return useQuery({
    queryKey: ["body", "readiness", session?.date ?? null, session?.title ?? null, goal?.race_date ?? null],
    queryFn: ({ signal }) => apiPost<DayVerdict>("/body/readiness", { session, goal: goalPayload }, signal),
    enabled,
    // Overnight figures are computed once, by Garmin, while you sleep.
    staleTime: 30 * 60_000,
  });
}

/** The same verdict, phrased by the model. Fetched separately, exactly like the
 * fuelling narrative: the screen paints from the deterministic headline and swaps this
 * in when (and if) it lands. */
export function useDayVerdictNarrative(session: TrainingSession | null, goal: RaceGoal | null | undefined, enabled = true) {
  const goalPayload = goal
    ? { race_date: goal.race_date, distance_km: goal.distance_km, name: goal.name, target_time_seconds: goal.target_time_seconds }
    : null;
  return useQuery({
    queryKey: ["body", "readiness-narrative", session?.date ?? null, session?.title ?? null, goal?.race_date ?? null],
    queryFn: ({ signal }) => apiPost<Narrative>("/body/readiness/narrative", { session, goal: goalPayload }, signal),
    enabled,
    staleTime: 30 * 60_000,
  });
}

/** Does this morning's readiness clash with the next planned session?
 *
 * `enabled` matters here: with no session to assess there is nothing to ask, and this
 * hook used to fire `{next_session: null}` at the server anyway -- a full body snapshot
 * computed to answer "no conflict", on every single Oggi load with an empty tomorrow. */
export function useBodyConflict(nextSession: TrainingSession | null) {
  return useQuery({
    queryKey: ["body", "conflict", nextSession?.date ?? null],
    queryFn: ({ signal }) => apiPost<ConflictAssessment>("/body/conflict", { next_session: nextSession }, signal),
    enabled: !!nextSession,
  });
}

// ---- strava (read-only) --------------------------------------------------------------------

export function useStravaStatus() {
  return useQuery({
    queryKey: ["strava", "status"],
    queryFn: ({ signal }) => apiGet<StravaStatus>("/strava/status", undefined, signal),
  });
}

/** Name + photo of the connected Strava athlete: the app's preferred identity for the
 * avatar and the profile card (see `useAthleteIdentity`). */
export function useStravaAthlete(enabled = true) {
  return useQuery({
    queryKey: ["strava", "athlete"],
    queryFn: ({ signal }) => apiGet<AthleteProfile>("/strava/athlete", undefined, signal),
    enabled,
    staleTime: 60 * 60_000,
  });
}

export function useStravaAuthorize() {
  return useMutation({
    mutationFn: () => apiGet<{ authorize_url: string }>("/strava/authorize"),
  });
}

export function useConnectStrava() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => apiPost<{ connected: boolean }>("/strava/connect", { code }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["strava", "status"] });
      const previous = queryClient.getQueryData<StravaStatus>(["strava", "status"]);
      queryClient.setQueryData<StravaStatus>(["strava", "status"], { connected: true });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(["strava", "status"], context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strava", "status"] });
      // A different athlete may be behind this token (the backend drops its own cached
      // answer for the same reason).
      queryClient.invalidateQueries({ queryKey: ["strava", "athlete"] });
    },
  });
}

export function useDisconnectStrava() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost<{ connected: boolean }>("/strava/disconnect"),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["strava", "status"] });
      const previous = queryClient.getQueryData<StravaStatus>(["strava", "status"]);
      queryClient.setQueryData<StravaStatus>(["strava", "status"], { connected: false });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(["strava", "status"], context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strava", "status"] });
      queryClient.removeQueries({ queryKey: ["strava", "athlete"] });
    },
  });
}

/** One cache slot per calendar day, shared by the single and batch hooks below.
 *
 * A match *is* per-day: the batch endpoint keys its results by date too, and a plan has
 * one session per day. Keying it this way is what lets a detail screen reuse the match
 * Settimana already fetched instead of asking Strava again for the same activity. */
function stravaMatchKey(dateKey: string | null) {
  return ["strava", "match", dateKey] as const;
}

export function useStravaActivityMatch(session: TrainingSession | null, enabled: boolean) {
  return useQuery({
    queryKey: stravaMatchKey(session?.date ?? null),
    queryFn: ({ signal }) => apiPost<StravaActivityMatch>("/strava/activity-match", { session }, signal),
    enabled: enabled && !!session,
    staleTime: session ? rangeStaleTime(session.date) : LIVE_STALE_TIME,
  });
}

/** Batch version for a whole week's worth of sessions at once (Week/Today) -- one
 * request covering the full date range instead of one `useStravaActivityMatch` per
 * visible day, matching the batch endpoint's `find_activity_matches_for_range`.
 *
 * Each day's result is also written into that day's own cache slot, so tapping into a
 * day's detail finds its match already there. */
export function useStravaActivityMatches(sessions: TrainingSession[], enabled: boolean) {
  const queryClient = useQueryClient();
  // The last day these sessions cover: once it has passed, no new Strava activity can
  // land on any of them, so the answer is final.
  const lastDate = sessions.reduce((latest, session) => (session.date > latest ? session.date : latest), "");
  const query = useQuery({
    queryKey: ["strava", "matches", sessions.length ? planFingerprint(sessions) : null],
    queryFn: ({ signal }) =>
      apiPost<{ matches: Record<string, StravaActivityMatch> }>("/strava/activity-matches", { sessions }, signal),
    enabled: enabled && sessions.length > 0,
    staleTime: lastDate ? rangeStaleTime(lastDate) : LIVE_STALE_TIME,
    placeholderData: keepPreviousData,
  });

  const matches = query.data?.matches;
  useEffect(() => {
    if (!matches) return;
    for (const [dateKey, match] of Object.entries(matches)) {
      queryClient.setQueryData(stravaMatchKey(dateKey), match);
    }
  }, [matches, queryClient]);

  return query;
}

export function useShoes(enabled = true) {
  return useQuery({
    queryKey: ["strava", "shoes"],
    queryFn: ({ signal }) => apiGet<{ shoes: Shoe[] }>("/strava/shoes", undefined, signal),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ---- body metrics + fuelling (nutrition) --------------------------------------------------

/** Garmin's weight/height/age -- the settings "Il tuo corpo" card reads this directly,
 * and it's what a manual weight (store.ts) is offered in place of. */
export function useBodyMetrics() {
  return useQuery({
    queryKey: ["body", "metrics"],
    queryFn: ({ signal }) => apiGet<BodyMetrics>("/body/metrics", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

/** Today's and tomorrow's carb/protein targets. `weightKg` is the manual override
 * (store.ts's `manualWeight`) when set, `undefined`/`null` otherwise -- omitting it
 * lets the backend fall back to Garmin, then to the 70 kg reference (see
 * `_resolve_weight` in routes_nutrition.py). The whole plan travels along, not just
 * today/tomorrow: the back-to-back-hard-days bump needs the day after tomorrow too. */
/** Everything a day's targets depend on is already in their query key -- the day, the
 * plan, the weight -- so the answer only goes stale when the *weight source* changes
 * behind the key (a fresh Garmin scale reading), which is a half-hour-scale event, not a
 * five-minute one. Past days never change at all. This is what stops /body and
 * /body/fuel re-asking for the same targets on every visit. */
function fuelStaleTime(date: string): number {
  return isPastDate(date) ? Infinity : 30 * 60_000;
}

/** `enabled` is not optional in practice: the plan is restored asynchronously, so a
 * screen that asks on its first render asks with an *empty* plan -- a full round-trip
 * (and, for the narrative, a paid model call) computed against "nothing scheduled",
 * immediately thrown away when the real plan lands under a different cache key. Callers
 * pass whatever tells them the plan has arrived. */
export function useFuelTargets(date: string, sessions: TrainingSession[], weightKg: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["nutrition", "targets", date, weightKg ?? null, sessions.length ? planFingerprint(sessions) : null],
    queryFn: ({ signal }) =>
      apiPost<FuelTargets>("/nutrition/targets", { date, sessions, weight_kg: weightKg ?? null }, signal),
    enabled,
    staleTime: fuelStaleTime(date),
  });
}

/** One `today` target per date -- what the weekly history chart (screen E2) needs to
 * tell "in target" from "sotto" for each of the last seven days, since `/nutrition/
 * history` only returns what was actually eaten, never what was asked for. A fixed-
 * length array of `useQuery`-shaped configs, not a loop of `useFuelTargets` calls: the
 * rules of hooks forbid a variable number of hook calls, which is exactly what mapping
 * a hook over a dynamic date list would be. */
export function useFuelTargetsForDates(dates: string[], sessions: TrainingSession[], weightKg: number | null | undefined, enabled = true) {
  const fingerprint = sessions.length ? planFingerprint(sessions) : null;
  return useQueries({
    queries: dates.map((date) => ({
      enabled,
      queryKey: ["nutrition", "targets", date, weightKg ?? null, fingerprint] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        apiPost<FuelTargets>("/nutrition/targets", { date, sessions, weight_kg: weightKg ?? null }, signal),
      staleTime: fuelStaleTime(date),
    })),
  });
}

/** The model's phrasing of the same targets -- fetched separately so the fuel screen
 * paints from `advice` immediately and swaps in `narrative` if/when this lands (see
 * routes_nutrition.py's module docstring). Never fails: the response always carries a
 * sentence, template or model. */
export function useFuelNarrative(date: string, sessions: TrainingSession[], weightKg: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["nutrition", "narrative", date, weightKg ?? null, sessions.length ? planFingerprint(sessions) : null],
    queryFn: ({ signal }) =>
      apiPost<Narrative>("/nutrition/narrative", { date, sessions, weight_kg: weightKg ?? null }, signal),
    enabled,
    // The slowest thing on the screen: a language-model round-trip, three to eight
    // seconds of it. It is written over the day's targets and what has been eaten so
    // far, and `invalidateNutrition` drops it the moment either changes -- so there is
    // nothing for a short staleTime to catch, only a wait to re-pay.
    staleTime: fuelStaleTime(date),
  });
}

/** Starts the narrative's model call before its screen exists.
 *
 * Called on touch-down from the Corpo tab's fuel card: the sentence is the slowest
 * thing on /body/fuel and the only one the user waits for, and the few hundred
 * milliseconds between finger-down and the screen mounting are free. On tap, not on
 * mount, so a visit to Corpo that never opens Carburante costs nothing -- this is the
 * one query in the app that spends money per call. */
export function usePrefetchFuelNarrative() {
  const queryClient = useQueryClient();
  return (date: string, sessions: TrainingSession[], weightKg: number | null | undefined) => {
    queryClient.prefetchQuery({
      queryKey: ["nutrition", "narrative", date, weightKg ?? null, sessions.length ? planFingerprint(sessions) : null],
      queryFn: ({ signal }) =>
        apiPost<Narrative>("/nutrition/narrative", { date, sessions, weight_kg: weightKg ?? null }, signal),
      staleTime: fuelStaleTime(date),
    });
  };
}

export function useFoodDay(date: string) {
  return useQuery({
    queryKey: ["nutrition", "day", date],
    queryFn: ({ signal }) => apiGet<FoodDay>("/nutrition/day", { date }, signal),
    // Photographing or correcting a meal invalidates this key (`invalidateNutrition`),
    // so a day in the past has nothing left to tell us.
    staleTime: rangeStaleTime(date),
  });
}

export function useFoodHistory(days = 7, end?: string) {
  return useQuery({
    queryKey: ["nutrition", "history", days, end ?? null],
    queryFn: ({ signal }) => apiGet<FoodHistory>("/nutrition/history", { days: String(days), end }, signal),
    staleTime: LIVE_STALE_TIME,
  });
}

/** Every meal logged over a window -- the diary screen's one request, instead of a
 * `useFoodDay` per day on screen. */
export function useFoodEntries(days = 14, end?: string) {
  return useQuery({
    queryKey: ["nutrition", "entries", days, end ?? null],
    queryFn: ({ signal }) => apiGet<FoodEntries>("/nutrition/entries", { days: String(days), end }, signal),
    staleTime: LIVE_STALE_TIME,
  });
}

/** Everything a change to the food log makes untrue.
 *
 * The narrative is in here because it is written *over* the day's running totals ("hai
 * già preso 210 g"), so a new meal makes the sentence on screen wrong -- it used to sit
 * there unchanged until its five minutes were up, which was the one case where caching
 * it aggressively would have been visible. The server drops its own copy on the same
 * writes (`invalidate_nutrition`). */
function invalidateNutrition(queryClient: ReturnType<typeof useQueryClient>, date?: string) {
  queryClient.invalidateQueries({ queryKey: date ? ["nutrition", "day", date] : ["nutrition", "day"] });
  queryClient.invalidateQueries({ queryKey: ["nutrition", "history"] });
  queryClient.invalidateQueries({ queryKey: ["nutrition", "entries"] });
  queryClient.invalidateQueries({ queryKey: ["nutrition", "narrative"] });
}

/** Estimate + store one plate. The entry is written server-side even when the model
 * can't read the photo (null macros, no confidence) -- the caller distinguishes that
 * case by `confidence == null` and routes to the manual-entry fallback (screen D4)
 * rather than treating it as a request failure. */
export function useLogPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ file, date, thumbnail }: { file: File; date: string; thumbnail?: Blob | null }) => {
      const form = new FormData();
      form.set("image", file);
      form.set("date", date);
      if (thumbnail) form.set("thumbnail", thumbnail, "thumbnail.jpg");
      return apiPostForm<FoodEntry>("/nutrition/photo", form);
    },
    onSuccess: (_entry, vars) => invalidateNutrition(queryClient, vars.date),
  });
}

/** Estimate + store one meal from a sentence the user typed. Same contract as
 * `useLogPhoto`: the row is written even when the model can't answer, and the caller
 * tells that case apart by `confidence == null`. */
export function useDescribeMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ text, date }: { text: string; date: string }) =>
      apiPost<FoodEntry>("/nutrition/describe", { text, date }),
    onSuccess: (_entry, vars) => invalidateNutrition(queryClient, vars.date),
  });
}

interface ManualEntryFields {
  description?: string | null;
  kcal?: number | null;
  carb_g?: number | null;
  protein_g?: number | null;
  fat_g?: number | null;
}

export function useAddManualEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ManualEntryFields & { date: string }) => apiPost<FoodEntry>("/nutrition/entry", payload),
    onSuccess: (_entry, vars) => invalidateNutrition(queryClient, vars.date),
  });
}

/** A correction (screen E1) or the manual fallback after a failed estimate (screen
 * D4) -- both patch the same entry and both mark it `corrected`. */
export function useUpdateEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...fields }: ManualEntryFields & { id: number }) =>
      apiPatch<FoodEntry>(`/nutrition/entry/${id}`, fields),
    onSuccess: () => invalidateNutrition(queryClient),
  });
}

export function useDeleteEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => apiDelete<{ deleted: boolean }>(`/nutrition/entry/${id}`),
    onSuccess: () => invalidateNutrition(queryClient),
  });
}

export function useRetireShoe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (gearId: string) => apiPost<{ id: string; retired: boolean }>(`/strava/shoes/${gearId}/retire`),
    onMutate: async (gearId) => {
      await queryClient.cancelQueries({ queryKey: ["strava", "shoes"] });
      const previous = queryClient.getQueryData<{ shoes: Shoe[] }>(["strava", "shoes"]);
      queryClient.setQueryData<{ shoes: Shoe[] } | undefined>(["strava", "shoes"], (old) =>
        old ? { shoes: old.shoes.map((s) => (s.id === gearId ? { ...s, retired: true } : s)) } : old
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context) queryClient.setQueryData(["strava", "shoes"], context.previous);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["strava", "shoes"] });
    },
  });
}
