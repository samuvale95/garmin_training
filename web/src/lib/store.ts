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

/** Local-only display identity (name/email the user types in Settings). There is no
 * account system behind this -- Garmin email/password is the only real credential the
 * app holds -- this just gives the avatar/profile card something to show. */
export interface Profile {
  name: string;
  email: string;
}

export interface WriteJobHistoryEntry {
  jobId: string;
  finishedAt: string;
  total: number;
  succeeded: number;
  failed: number;
  items: SyncItemResult[];
  /** Wall-clock time the write took, client-measured (the backend doesn't track job
   * timing) -- null when the start time wasn't captured (e.g. page reload mid-job). */
  durationMs: number | null;
}

interface PassoStore {
  plan: PlanState | null;
  prefs: Prefs;
  profile: Profile;
  writeJobHistory: WriteJobHistoryEntry[];
  /** Last Garmin email a connect attempt was made with -- never the password (see
   * connect-garmin's "mai la password" promise). Lets the rate-limit screen offer an
   * "update the password" retry without asking for the email again. */
  lastGarminEmail: string | null;
  /** Date key (YYYY-MM-DD) the body-conflict screen was last dismissed on -- keeps
   * Today from bouncing straight back to /body/conflict after the user picks
   * "Lascia tutto com'è" or acts on it, for the rest of that day. */
  conflictDismissedDate: string | null;

  setPlan: (plan: PlanState) => void;
  clearPlan: () => void;
  updateSession: (index: number, updater: (session: TrainingSession) => TrainingSession) => void;

  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setProfile: (profile: Profile) => void;
  setLastGarminEmail: (email: string) => void;
  dismissConflictToday: (dateKey: string) => void;

  addJobHistory: (entry: WriteJobHistoryEntry) => void;
}

const defaultPrefs: Prefs = {
  avvisamiSeIlCorpoNonRegge: true,
  // "Chiedi prima di cancellare" defaults on, by design (README screen 15).
  chiediPrimaDiCancellare: true,
  menoMovimento: false,
};

const defaultProfile: Profile = { name: "", email: "" };

export const usePassoStore = create<PassoStore>()(
  persist(
    (set) => ({
      plan: null,
      prefs: defaultPrefs,
      profile: defaultProfile,
      writeJobHistory: [],
      lastGarminEmail: null,
      conflictDismissedDate: null,

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
      setProfile: (profile) => set({ profile }),
      setLastGarminEmail: (email) => set({ lastGarminEmail: email }),
      dismissConflictToday: (dateKey) => set({ conflictDismissedDate: dateKey }),

      addJobHistory: (entry) =>
        set((state) => ({ writeJobHistory: [entry, ...state.writeJobHistory].slice(0, 20) })),
    }),
    {
      name: "passo-device-state",
      // Only plan/prefs/profile/history are persisted here -- diff/calendar/body data
      // are TanStack Query cache only (design.md's state-mapping table), never written
      // to this store.
      partialize: (state) => ({
        plan: state.plan,
        prefs: state.prefs,
        profile: state.profile,
        writeJobHistory: state.writeJobHistory,
        lastGarminEmail: state.lastGarminEmail,
        conflictDismissedDate: state.conflictDismissedDate,
      }),
    }
  )
);
