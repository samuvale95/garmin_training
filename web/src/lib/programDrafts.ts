"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/apiClient";
import type { TrainingSession } from "@/lib/types";

export const GOAL_TYPES = { race: "Gara", performance: "Prestazione", fitness: "Forma fisica", strength: "Forza", consistency: "Costanza", maintenance: "Mantenimento" } as const;
export type GoalType = keyof typeof GOAL_TYPES;
export interface TrainingGoal {
  id: string; revision: number; type: GoalType; name: string; description?: string | null; sports: string[]; priority: "primary" | "secondary";
  status: "active" | "completed" | "archived"; deadline?: string | null; review_date?: string | null; review_interval_days: number;
  baseline?: { value?: number; recorded_at?: string; source?: string } | null;
  success_criterion?: { metric?: string; target?: number; unit?: string } | null;
  race_date?: string | null; distance_km?: number | null; target_time_seconds?: number | null; linked_program_ids: string[];
}
export interface GoalEvaluation {
  id?: string; evaluated_at?: string; created_at?: string; status: string; execution?: Record<string, unknown>; progress?: Record<string, unknown>; quality?: Record<string, unknown>; evidence?: unknown; summary?: string;
}
export interface ProgramConstraints { revision: number; available_days: number[] | null; max_daily_minutes: number | null; max_sessions_per_day: number | null }
export interface DraftValidation {
  token: string; status: "compatible" | "conflict" | "insufficient_data"; conflicts: Array<string | Record<string, unknown>>; warnings: Array<string | Record<string, unknown>>; missing_data: string[];
  impact: { added: TrainingSession[]; removed: TrainingSession[]; preserved: TrainingSession[]; programs: Array<{id:string;name:string;is_active:boolean}> }; reviewed_on?: string;
}
export interface ProgramDraft {
  id: string; revision: number; status: "draft" | "generating" | "ready" | "failed" | "active";
  name: string; source: "ai" | "import"; mode: "new" | "merge" | "replace"; target_plan_id?: string | null; goal_id?: string | null;
  inputs: Record<string, unknown>; original_yaml?: string | null; sessions: TrainingSession[]; skeleton?: unknown; validation?: DraftValidation | null;
  result?: { plan_id: string } | null; error?: string | { message: string; details?: unknown[] } | null; created_at?: string; updated_at?: string;
}
export type DraftInput = Pick<ProgramDraft, "name" | "source" | "mode" | "inputs"> & Partial<Pick<ProgramDraft, "target_plan_id" | "goal_id" | "original_yaml" | "sessions">>;
const listKeys = [["plan-state"], ["plans-list"], ["plan-drafts"], ["training-goals"]];
export function useProgramDrafts() { return useQuery({ queryKey: ["plan-drafts"], queryFn: ({ signal }) => apiGet<{ drafts: ProgramDraft[] }>("/plan/drafts", undefined, signal) }); }
export function useProgramDraft(id: string) { return useQuery({ queryKey: ["plan-draft", id], queryFn: ({ signal }) => apiGet<ProgramDraft>(`/plan/drafts/${id}`, undefined, signal), enabled: !!id, refetchInterval: q => q.state.data?.status === "generating" ? 1500 : false }); }
export function useDraftMutation(action: "create" | "edit" | "generate" | "validate" | "activate") {
  const client = useQueryClient();
  return useMutation({ mutationFn: (arg: { id?: string; body: unknown }) => {
    const path = arg.id ? `/plan/drafts/${arg.id}` : "/plan/drafts";
    return action === "edit" ? apiPatch<ProgramDraft>(path, arg.body) : apiPost<ProgramDraft>(action === "create" ? path : `${path}/${action}`, arg.body);
  }, onSuccess: (data, arg) => {
    if (data?.id) client.setQueryData(["plan-draft", data.id], data);
    if (arg.id) client.invalidateQueries({ queryKey: ["plan-draft", arg.id] });
    for (const queryKey of listKeys) client.invalidateQueries({ queryKey });
  }});
}
export function useTrainingGoals() { return useQuery({ queryKey: ["training-goals"], queryFn: ({ signal }) => apiGet<{ goals: TrainingGoal[] }>("/goals", undefined, signal) }); }
export function useSaveTrainingGoal() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (arg: { id?: string; body: unknown }) => arg.id ? apiPatch<TrainingGoal>(`/goals/${arg.id}`, arg.body) : apiPost<TrainingGoal>("/goals", arg.body), onSuccess: () => client.invalidateQueries({ queryKey: ["training-goals"] }) });
}
export function useGoalEvaluations(id: string) { return useQuery({ queryKey: ["goal-evaluations", id], queryFn: ({ signal }) => apiGet<{ evaluations: GoalEvaluation[] }>(`/goals/${id}/evaluations`, undefined, signal), enabled: !!id }); }
export function useEvaluateGoal() { const client = useQueryClient(); return useMutation({ mutationFn: (id: string) => apiPost<GoalEvaluation>(`/goals/${id}/evaluations`, {}), onSuccess: (_, id) => client.invalidateQueries({ queryKey: ["goal-evaluations", id] }) }); }
export function useProgramConstraints() { return useQuery({ queryKey: ["plan-constraints"], queryFn: ({ signal }) => apiGet<ProgramConstraints>("/plan/constraints", undefined, signal) }); }
export function useSaveProgramConstraints() { const client = useQueryClient(); return useMutation({ mutationFn: (body: unknown) => apiPut<ProgramConstraints>("/plan/constraints", body), onSuccess: (data) => client.setQueryData(["plan-constraints"], data) }); }
export function draftMessage(value: string | Record<string, unknown>): string { return typeof value === "string" ? value : String(value.message ?? value.reason ?? value.description ?? JSON.stringify(value)); }
export function useProgramActivationReview() { return useMutation({ mutationFn: (id: string) => apiPost<DraftValidation>(`/plan/${id}/activation-review`, {}) }); }
export function useProgramGoalLinks(id: string) { return useQuery({ queryKey: ["program-goal-links", id], queryFn: ({ signal }) => apiGet<{ context_revision: number; primary_goal_id: string | null; contributing_goal_ids: string[] }>(`/plan/${id}/goals`, undefined, signal), enabled: !!id }); }
export function useSaveProgramGoalLinks() { const client=useQueryClient();return useMutation({ mutationFn: ({ id, body }: { id: string; body: unknown })=>apiPut(`/plan/${id}/goals`,body),onSuccess:(_,arg)=>{client.invalidateQueries({queryKey:["program-goal-links",arg.id]});client.invalidateQueries({queryKey:["training-goals"]});} }); }
