"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiPut } from "./apiClient";

/** Admin-only: the agents' settings, runs and proposals (see `api/routes_agents.py`). */

export interface AgentSettings {
  enabled: boolean;
  hard_disabled: boolean;
  daily_budget_usd: number;
  monthly_budget_usd: number;
  spent_today_usd: number;
  spent_month_usd: number;
}

export interface AgentInfo {
  name: string;
  description: string;
  schedule: "daily" | "weekly";
  max_steps: number;
  max_cost_per_run_usd: number;
  max_proposals_per_week: number;
  last_success: string | null;
}

export interface AgentRun {
  id: number;
  agent: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  steps: number;
  llm_calls: number;
  cost_usd: number;
  output: { anomalies?: Record<string, unknown>[]; proposals?: number[]; skipped?: string[] };
  error: string | null;
}

export type ProposalStatus = "nuova" | "approvata" | "scartata" | "realizzata";

export interface AgentProposal {
  id: number;
  agent: string;
  run_id: number | null;
  category: "ui_config" | "code" | "training_algorithm";
  title: string;
  problem: string;
  evidence: Record<string, unknown>;
  severity: "bassa" | "media" | "alta";
  confidence: number;
  proposal: string;
  impact: string | null;
  effort: string | null;
  status: ProposalStatus;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
}

// Admin data is never persisted or kept stale: it is read rarely and must be current.
const live = { staleTime: 0, gcTime: 60_000 } as const;

export function useIsAdmin() {
  return useQuery({
    queryKey: ["admin", "me"],
    queryFn: ({ signal }) => apiGet<{ is_admin: boolean }>("/admin/me", undefined, signal),
    staleTime: 60 * 60_000,
  });
}

export function useAgentsOverview() {
  return useQuery({
    queryKey: ["admin-agents", "overview"],
    queryFn: ({ signal }) => apiGet<{ settings: AgentSettings; agents: AgentInfo[] }>("/admin/agents", undefined, signal),
    ...live,
  });
}

export function useAgentRuns() {
  return useQuery({
    queryKey: ["admin-agents", "runs"],
    queryFn: ({ signal }) => apiGet<AgentRun[]>("/admin/agents/runs", { limit: "30" }, signal),
    ...live,
    // A manual run finishes in the background: poll while one is still going.
    refetchInterval: (query) => (query.state.data?.some((run) => run.status === "running") ? 3000 : false),
  });
}

export function useAgentProposals(status: ProposalStatus | "tutte") {
  return useQuery({
    queryKey: ["admin-agents", "proposals", status],
    queryFn: ({ signal }) =>
      apiGet<AgentProposal[]>("/admin/agents/proposals", status === "tutte" ? undefined : { status }, signal),
    ...live,
  });
}

function useInvalidateAgents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["admin-agents"] });
}

export function useUpdateAgentSettings() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (fields: Partial<Pick<AgentSettings, "enabled" | "daily_budget_usd" | "monthly_budget_usd">>) =>
      apiPut<AgentSettings>("/admin/agents/settings", fields),
    onSuccess: invalidate,
  });
}

export function useRunAgent() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: (name: string) => apiPost<{ started: string }>(`/admin/agents/${name}/run`),
    // The run row appears a moment after the 202; refetch once it has.
    onSuccess: () => setTimeout(invalidate, 800),
  });
}

export function useDecideProposal() {
  const invalidate = useInvalidateAgents();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: ProposalStatus; note?: string }) =>
      apiPost<{ id: number; status: ProposalStatus }>(`/admin/agents/proposals/${id}/decision`, { status, note }),
    onSuccess: invalidate,
  });
}
