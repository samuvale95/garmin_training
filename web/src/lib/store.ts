"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SyncItemResult } from "./types";

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
  /** A weight typed in by the user, device-local (see handoff-carburante/SPEC.md
   * "Il valore che scrivi tu vince"). Wins over whatever Garmin reports until cleared
   * -- sent as `weight_kg` on every /nutrition/targets and /nutrition/narrative call,
   * which is what turns it into `weight_source: "manual"` server-side. */
  manualWeight: { weightKg: number; setOn: string } | null;

  setPref: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  setProfile: (profile: Profile) => void;
  setLastGarminEmail: (email: string) => void;
  dismissConflictToday: (dateKey: string) => void;
  setManualWeight: (weightKg: number | null) => void;

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
      prefs: defaultPrefs,
      profile: defaultProfile,
      writeJobHistory: [],
      lastGarminEmail: null,
      conflictDismissedDate: null,
      manualWeight: null,

      setPref: (key, value) => set((state) => ({ prefs: { ...state.prefs, [key]: value } })),
      setProfile: (profile) => set({ profile }),
      setLastGarminEmail: (email) => set({ lastGarminEmail: email }),
      dismissConflictToday: (dateKey) => set({ conflictDismissedDate: dateKey }),
      setManualWeight: (weightKg) =>
        set({ manualWeight: weightKg != null ? { weightKg, setOn: new Date().toISOString() } : null }),

      addJobHistory: (entry) =>
        set((state) => ({ writeJobHistory: [entry, ...state.writeJobHistory].slice(0, 20) })),
    }),
    {
      name: "passo-device-state",
      // Only prefs/profile/history are persisted here. `plan` lives in the TanStack
      // Query cache instead (see usePlanQuery in queries.ts), and diff/calendar/body
      // data are TanStack Query cache only too (design.md's state-mapping table),
      // never written to this store.
      partialize: (state) => ({
        prefs: state.prefs,
        profile: state.profile,
        writeJobHistory: state.writeJobHistory,
        lastGarminEmail: state.lastGarminEmail,
        conflictDismissedDate: state.conflictDismissedDate,
        manualWeight: state.manualWeight,
      }),
      // zustand/persist's default merge is a single shallow spread of the persisted
      // blob over the fresh state -- a `prefs`/`profile` that's partial (an older app
      // version with fewer fields, hand-edited localStorage, a partly-cleared legacy
      // key) replaces the whole nested object instead of filling gaps, leaving fields
      // like `profile.name` `undefined` where code assumes a string (e.g. Avatar.tsx's
      // `.trim()`). Merge those two nested objects one level deeper so a partial
      // record still ends up with every default field.
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<PassoStore>;
        return {
          ...currentState,
          ...persisted,
          prefs: { ...currentState.prefs, ...persisted.prefs },
          profile: { ...currentState.profile, ...persisted.profile },
        };
      },
    }
  )
);
