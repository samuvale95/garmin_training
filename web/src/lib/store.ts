"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SyncItemResult, TrainingSession } from "./types";

export interface PlanState {
  yamlText: string;
  sessions: TrainingSession[];
  filename: string | null;
  importedAt: string | null;
}

export interface Prefs {
  avvisamiSeIlCorpoNonRegge: boolean;
  chiediPrimaDiCancellare: boolean;
  menoMovimento: boolean;
}

export interface WriteJobHistoryEntry {
  jobId: string;
  finishedAt: string;
  total: number;
  succeeded: number;
  failed: number;
  items: SyncItemResult[];
}

interface PassoStore {
  plan: PlanState | null;
  prefs: Prefs;
  writeJobHistory: WriteJobHistoryEntry[];

  setPlan: (plan: PlanState) => void;
  clearPlan: () => void;
  updateSession: (index: number, updater: (session: TrainingSession) => TrainingSession) => void;

  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;

  addJobHistory: (entry: WriteJobHistoryEntry) => void;
}

const defaultPrefs: Prefs = {
  avvisamiSeIlCorpoNonRegge: true,
  // "Chiedi prima di cancellare" defaults on, by design (README screen 15).
  chiediPrimaDiCancellare: true,
  menoMovimento: false,
};

export const usePassoStore = create<PassoStore>()(
  persist(
    (set) => ({
      plan: null,
      prefs: defaultPrefs,
      writeJobHistory: [],

      setPlan: (plan) => set({ plan }),
      clearPlan: () => set({ plan: null }),
      updateSession: (index, updater) =>
        set((state) => {
          if (!state.plan) return state;
          const sessions = [...state.plan.sessions];
          if (!sessions[index]) return state;
          sessions[index] = updater(sessions[index]);
          return { plan: { ...state.plan, sessions } };
        }),

      setPref: (key, value) => set((state) => ({ prefs: { ...state.prefs, [key]: value } })),

      addJobHistory: (entry) =>
        set((state) => ({ writeJobHistory: [entry, ...state.writeJobHistory].slice(0, 20) })),
    }),
    {
      name: "passo-device-state",
      // Only plan/prefs/history are persisted here -- diff/calendar/body data are
      // TanStack Query cache only (design.md's state-mapping table), never written
      // to this store.
      partialize: (state) => ({
        plan: state.plan,
        prefs: state.prefs,
        writeJobHistory: state.writeJobHistory,
      }),
    }
  )
);
