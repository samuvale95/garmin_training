"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPostForm } from "./apiClient";
import type {
  BodySnapshot,
  CompletedActivity,
  ConflictAssessment,
  DeleteResult,
  DeviceInfo,
  GarminStatus,
  LoadSnapshot,
  PlanDiff,
  ScheduledWorkout,
  Shoe,
  StravaActivityMatch,
  StravaStatus,
  SyncJobStatus,
  TrainingSession,
} from "./types";

// ---- plan / sessions (client-only, no backend record -- see usePlanQuery below) ---------

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

/** The imported plan is "genuinely device-only" (design.md, passo-nextjs-web-app):
 * the backend never stores it, only receives it per-request to diff/sync. It lives in
 * the TanStack Query cache like every other piece of app data, but with no real
 * `queryFn` (there is nothing to fetch) -- `staleTime: Infinity` keeps it from ever
 * being silently refetched into nothing. All writes go through `queryClient.
 * setQueryData` below, mirrored into localStorage in the same tick.
 *
 * The localStorage read itself happens in an effect, not in `initialData`: Next.js
 * server-renders this ("use client") page too, where `localStorage` doesn't exist, so
 * seeding synchronously would make the client's first render disagree with the
 * server-rendered HTML and trigger a React hydration-mismatch (a full, jank-y
 * client-side re-render of the tree). Deferring the read to `useEffect` keeps the
 * first client render identical to the server's (both start from `null`), then
 * hydrates a tick later -- `isHydrated` lets callers that redirect on a missing plan
 * (see guards.ts) hold off until that tick has happened, so an existing plan doesn't
 * cause a spurious bounce to /import.
 */
export function usePlanQuery() {
  const queryClient = useQueryClient();
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    const persisted = readPersistedPlan();
    if (persisted) {
      queryClient.setQueryData<PlanState | null>(["plan"], persisted);
      // Migrated from the legacy Zustand key (or just a normal re-read) -- writing it
      // back under the new key makes it the source of truth from here on, so this
      // fallback only ever does real work once per browser.
      persistPlan(persisted);
    }
    setIsHydrated(true);
    // Runs once on mount only -- queryClient identity is stable for the app's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const query = useQuery({
    queryKey: ["plan"],
    queryFn: (): PlanState | null => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return { ...query, isHydrated };
}

function writePlan(queryClient: ReturnType<typeof useQueryClient>, next: PlanState | null): void {
  queryClient.setQueryData<PlanState | null>(["plan"], next);
  persistPlan(next);
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
    }
  };
}

export function useUpdateSession() {
  const queryClient = useQueryClient();
  return (index: number, updater: (session: TrainingSession) => TrainingSession) => {
    const current = queryClient.getQueryData<PlanState | null>(["plan"]);
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
    const current = queryClient.getQueryData<PlanState | null>(["plan"]);
    const base = current ?? { yamlText: "", sessions: [], filename: null, importedAt: new Date().toISOString() };
    const sessions = [...base.sessions, session];
    writePlan(queryClient, { ...base, sessions });
    return sessions.length - 1;
  };
}

export function useRemoveSession() {
  const queryClient = useQueryClient();
  return (index: number) => {
    const current = queryClient.getQueryData<PlanState | null>(["plan"]);
    if (!current) return;
    const sessions = current.sessions.filter((_, i) => i !== index);
    writePlan(queryClient, { ...current, sessions });
  };
}

// ---- garmin connection -----------------------------------------------------------------

export function useGarminStatus() {
  return useQuery({
    queryKey: ["garmin", "status"],
    queryFn: () => apiGet<GarminStatus>("/garmin/status"),
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
    },
  });
}

export function useGarminDevice(enabled = true) {
  return useQuery({
    queryKey: ["garmin", "device"],
    queryFn: () => apiGet<DeviceInfo>("/garmin/device"),
    enabled,
    staleTime: 5 * 60_000,
  });
}

// ---- plan: parse / diff -----------------------------------------------------------------

export function useParsePlanText() {
  return useMutation({
    mutationFn: (yamlText: string) => {
      const form = new FormData();
      form.set("yaml_text", yamlText);
      return apiPostForm<{ sessions: TrainingSession[] }>("/plan/parse", form);
    },
  });
}

export function useParsePlanFile() {
  return useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.set("file", file);
      return apiPostForm<{ sessions: TrainingSession[] }>("/plan/parse", form);
    },
  });
}

export function usePlanDiff(sessions: TrainingSession[] | null) {
  return useQuery({
    // Recomputed on every mount/visit -- the diff is derived, never cached long
    // (README: "il diff è derivato... ricalcolarlo a ogni apertura").
    queryKey: ["plan", "diff", sessions],
    queryFn: () => apiPost<PlanDiff>("/plan/diff", { sessions, check_content: true }),
    enabled: !!sessions && sessions.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
}

// ---- plan: sync job ----------------------------------------------------------------------

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
    queryKey: ["plan", "sync-job", jobId],
    queryFn: () => apiGet<SyncJobStatus>(`/plan/sync/${jobId}`),
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

export function useWorkouts(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["garmin", "workouts", start, end],
    queryFn: () => apiGet<{ workouts: ScheduledWorkout[] }>("/garmin/workouts", { start, end }),
    enabled,
  });
}

/** The full step structure behind a live Garmin-calendar workout (no local plan) --
 * lets `/workout/[id]` render the exact same session-detail view as an imported
 * plan's session, instead of only ever knowing date/sport/title (see
 * `ScheduledWorkout`). `workout` is the calendar entry from `useWorkouts`, whose
 * date/sport/title travel along as query params since Garmin's workout definition
 * itself carries no calendar date. */
export function useWorkoutSession(workout: ScheduledWorkout | null, enabled = true) {
  return useQuery({
    queryKey: ["garmin", "workout-session", workout?.workout_id],
    queryFn: () =>
      apiGet<TrainingSession>(`/garmin/workouts/${workout!.workout_id}/session`, {
        date: workout!.date,
        sport: workout!.sport,
        title: workout!.title,
      }),
    enabled: enabled && !!workout,
  });
}

export function useActivities(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["garmin", "activities", start, end],
    queryFn: () => apiGet<{ activities: CompletedActivity[] }>("/garmin/activities", { start, end }),
    enabled,
    staleTime: 5 * 60_000,
  });
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

// ---- body insights (read-only) -------------------------------------------------------------

export function useBodyToday() {
  return useQuery({
    queryKey: ["body", "today"],
    queryFn: () => apiGet<BodySnapshot>("/body/today"),
    staleTime: 5 * 60_000,
  });
}

export function useBodyLoad() {
  return useQuery({
    queryKey: ["body", "load"],
    queryFn: () => apiGet<LoadSnapshot>("/body/load"),
    staleTime: 5 * 60_000,
  });
}

export function useBodyConflict(nextSession: TrainingSession | null) {
  return useQuery({
    queryKey: ["body", "conflict", nextSession],
    queryFn: () => apiPost<ConflictAssessment>("/body/conflict", { next_session: nextSession }),
    staleTime: 5 * 60_000,
  });
}

// ---- strava (read-only) --------------------------------------------------------------------

export function useStravaStatus() {
  return useQuery({
    queryKey: ["strava", "status"],
    queryFn: () => apiGet<StravaStatus>("/strava/status"),
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
    },
  });
}

export function useStravaActivityMatch(session: TrainingSession | null, enabled: boolean) {
  return useQuery({
    queryKey: ["strava", "activity-match", session],
    queryFn: () => apiPost<StravaActivityMatch>("/strava/activity-match", { session }),
    enabled: enabled && !!session,
    staleTime: 5 * 60_000,
  });
}

/** Batch version for a whole week's worth of sessions at once (Week/Today) -- one
 * request covering the full date range instead of one `useStravaActivityMatch` per
 * visible day, matching the batch endpoint's `find_activity_matches_for_range`.
 * Keyed by each session's own date (YYYY-MM-DD). */
export function useStravaActivityMatches(sessions: TrainingSession[], enabled: boolean) {
  return useQuery({
    queryKey: ["strava", "activity-matches", sessions],
    queryFn: () => apiPost<{ matches: Record<string, StravaActivityMatch> }>("/strava/activity-matches", { sessions }),
    enabled: enabled && sessions.length > 0,
    staleTime: 5 * 60_000,
  });
}

export function useShoes(enabled = true) {
  return useQuery({
    queryKey: ["strava", "shoes"],
    queryFn: () => apiGet<{ shoes: Shoe[] }>("/strava/shoes"),
    enabled,
    staleTime: 5 * 60_000,
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
