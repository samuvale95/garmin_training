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
  setSelection: (toCreate: TrainingSession[], changed: ChangedSession[]) => void;
  clear: () => void;
}

export const useSyncFlowStore = create<SyncFlowStore>((set) => ({
  toCreate: [],
  changed: [],
  setSelection: (toCreate, changed) => set({ toCreate, changed }),
  clear: () => set({ toCreate: [], changed: [] }),
}));
