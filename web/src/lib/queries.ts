"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPostForm } from "./apiClient";
import type {
  BodySnapshot,
  ConflictAssessment,
  DeleteResult,
  GarminStatus,
  LoadSnapshot,
  PlanDiff,
  ScheduledWorkout,
  SyncJobStatus,
  TrainingSession,
} from "./types";

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["garmin", "status"] });
    },
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

export function useDeletionPreview() {
  return useMutation({
    mutationFn: (payload: { start: string; end: string; sport?: string; title_match?: string }) =>
      apiPost<{ selected: ScheduledWorkout[] }>("/garmin/deletions/preview", payload),
  });
}

export function useApplyDeletion() {
  return useMutation({
    mutationFn: (workouts: ScheduledWorkout[]) =>
      apiPost<{ results: DeleteResult[] }>("/garmin/deletions/apply", { workouts }),
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
