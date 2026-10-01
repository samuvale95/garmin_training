"use client";

import { useSyncExternalStore } from "react";
import { apiPost } from "./apiClient";
import { useUpdateSession } from "./queries";
import type { MoveCheck, MoveWarning, TrainingSession } from "./types";

/** A move that came back with warnings, waiting for the user's answer. One at a time,
 * held outside React so the week screen and the editor can both raise it and the sheet
 * (mounted once, in AppShell) can show it wherever the user is by then. */
export interface PendingMove {
  sessionId: string;
  from: string;
  to: string;
  check: MoveCheck;
}

let pending: PendingMove | null = null;
const listeners = new Set<() => void>();

function publish(next: PendingMove | null) {
  pending = next;
  for (const listener of listeners) listener();
}

export function usePendingMove(): PendingMove | null {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => pending,
    () => null
  );
}

export function recordMoveDecision(move: PendingMove, choice: "confermo" | "adatta" | "annulla") {
  apiPost("/plan/move-decisions", {
    session_id: move.sessionId,
    date: move.to,
    choice,
    warnings: move.check.warnings,
  }).catch(() => {});
}

export function clearPendingMove() {
  publish(null);
}

/** Ask the server what a move just made would make risky (see
 * `training_plan/move_check.py`). The move itself is already applied: this never delays
 * it, and a failed check leaves it as it is. */
export function checkMoveAfterwards(sessionId: string, from: string, to: string) {
  if (from === to) return;
  apiPost<MoveCheck>("/plan/move-check", { session_id: sessionId, date: to, from_date: from })
    .then((check) => {
      if (check.warnings.length > 0) publish({ sessionId, from, to, check });
    })
    .catch(() => {});
}

/** Move a plan session to another day, then check the move. */
export function useMoveSession() {
  const updateSession = useUpdateSession();
  return (sessionId: string, from: string, to: string) => {
    updateSession(sessionId, (s: TrainingSession) => ({ ...s, date: to }));
    checkMoveAfterwards(sessionId, from, to);
  };
}

export const EVIDENCE_LABELS: Record<MoveWarning["evidence"], string> = {
  ricerca: "dimostrato dalla ricerca",
  consenso: "condiviso dagli allenatori",
  prudenza: "per prudenza",
};

export function isAcwrWarning(key: string): boolean {
  return key === "acwr_high" || key === "acwr_excessive";
}

/** Compute projected 7-day acute volume and ACWR for a given date given a chronic baseline. */
export function computeProjectedAcwr(
  sessions: TrainingSession[],
  chronicWeeklyMinutes: number | null,
  targetDate: string
): { acwr: number | null; acuteMinutes: number } {
  if (!chronicWeeklyMinutes || chronicWeeklyMinutes < 10) {
    return { acwr: null, acuteMinutes: 0 };
  }
  const target = new Date(targetDate);
  const start = new Date(target);
  start.setDate(target.getDate() - 6);

  let acuteMinutes = 0;
  for (const s of sessions) {
    if (s.sport !== "running") continue;
    const d = new Date(s.date);
    if (d >= start && d <= target) {
      for (const step of s.steps || []) {
        if ("reps" in step) {
          for (const sub of step.steps || []) {
            if (sub.duration_type === "time") acuteMinutes += sub.duration_value * step.reps;
          }
        } else if (step.duration_type === "time") {
          acuteMinutes += step.duration_value;
        }
      }
    }
  }

  const acwr = Math.round((acuteMinutes / chronicWeeklyMinutes) * 100) / 100;
  return { acwr, acuteMinutes: Math.round(acuteMinutes) };
}
