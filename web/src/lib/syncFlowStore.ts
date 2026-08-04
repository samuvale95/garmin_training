"use client";

import { create } from "zustand";
import type { ChangedSession, TrainingSession } from "./types";

/**
 * Transient (non-persisted) hand-off between /diff -> /confirm-deletions -> /sync.
 * Deliberately NOT part of the persisted device store: the diff is derived data
 * (design.md's state-mapping table) and this is just passing the current flow's
 * selection between steps, not something that should survive a reload.
 */
interface SyncFlowStore {
  toCreate: TrainingSession[];
  changed: ChangedSession[];
  /** Wall-clock start of the in-flight write job, so /sync can hand a duration to
   * writeJobHistory when the job finishes -- the backend doesn't track job timing. */
  startedAt: number | null;
  setSelection: (toCreate: TrainingSession[], changed: ChangedSession[]) => void;
  markStarted: () => void;
  clear: () => void;
}

export const useSyncFlowStore = create<SyncFlowStore>((set) => ({
  toCreate: [],
  changed: [],
  startedAt: null,
  setSelection: (toCreate, changed) => set({ toCreate, changed }),
  markStarted: () => set({ startedAt: Date.now() }),
  clear: () => set({ toCreate: [], changed: [], startedAt: null }),
}));
