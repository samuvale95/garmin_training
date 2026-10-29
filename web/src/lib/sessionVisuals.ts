import type { IllustrationName } from "@/components/Illustration";
import { sessionFallbackPaceSecPerKm, stepDistanceKm } from "./format";
import { flattenSteps, isRepeatBlock } from "./types";
import type { ScheduledWorkout, SessionStep, ShortVariant, Sport, TrainingSession } from "./types";

export type SessionKind = "riposo" | "ripetute" | "fondo_lento" | "forza" | "lungo" | "calisthenics" | "bici";

/** Shared shape for anything rendered on Oggi/Settimana -- an imported plan's
 * `TrainingSession` (steps present, distance/interval-aware) or a raw Garmin
 * `ScheduledWorkout` (steps absent, only date/sport/title) both satisfy this
 * structurally, so the calendar screens don't need separate render paths. */
export interface DisplaySession {
  date: string;
  sport: string;
  title: string;
  description?: string | null;
  priority?: "key" | "flexible" | "normal" | "optional" | null;
  min_duration_minutes?: number | null;
  steps?: SessionStep[];
  is_short_active?: boolean;
  short_variant?: ShortVariant | null;
}

export interface SessionVisual {
  kind: SessionKind;
  label: string;
  background: string;
  foreground: string;
  illustration: IllustrationName | null;
}

const VISUALS: Record<SessionKind, Omit<SessionVisual, "kind">> = {
  riposo: { label: "Riposo", background: "var(--sabbia)", foreground: "var(--inchiostro-70)", illustration: "riposo" },
  ripetute: { label: "Ripetute", background: "var(--corallo)", foreground: "var(--corallo-testo)", illustration: "corsa" },
  fondo_lento: { label: "Fondo lento", background: "var(--azzurro)", foreground: "var(--azzurro-testo)", illustration: "fondo_lento" },
  forza: { label: "Forza", background: "var(--lilla)", foreground: "var(--lilla-testo)", illustration: "forza" },
  calisthenics: { label: "Calisthenics", background: "rgba(168, 85, 247, 0.15)", foreground: "#7E22CE", illustration: "forza" },
  bici: { label: "Bici", background: "var(--verde)", foreground: "var(--verde-testo)", illustration: "bici" },
  lungo: { label: "Lungo", background: "var(--verde)", foreground: "var(--verde-testo)", illustration: "corsa" },
};

/** Returns effective steps honoring is_short_active. */
export function effectiveSteps(session: DisplaySession): SessionStep[] {
  if (session.is_short_active && session.short_variant?.steps && session.short_variant.steps.length > 0) {
    return session.short_variant.steps;
  }
  return session.steps ?? [];
}

/** Returns effective title honoring is_short_active. */
export function effectiveTitle(session: DisplaySession): string {
  if (session.is_short_active && session.short_variant?.title) {
    return session.short_variant.title;
  }
  return session.title;
}

/** Returns effective description honoring is_short_active. */
export function effectiveDescription(session: DisplaySession): string | null {
  if (session.is_short_active && session.short_variant?.description) {
    return session.short_variant.description;
  }
  return session.description ?? null;
}

/** A continuous run at or above this distance reads as the week's long one. */
const LONG_RUN_KM = 15;

/** Classifies a session into the design's five day-card types. The file format only
 * carries sport + steps, not an explicit category, so this is a heuristic -- good
 * enough to drive card color/illustration, not a source of truth about training
 * intent.
 *
 * "Has an interval step" is *not* that heuristic, which is what this used to test: a
 * plain continuous run is written as a single `interval` step (see
 * `examples/agosto_settembre_2026.yaml`, where `Corsa 40' ritmo costante` is exactly
 * that), so every run in the plan came out "ripetute" and Settimana rendered the whole
 * week in one shade of coral. Repetition work is what has *more than one* effort in it
 * -- a repeat block, or several interval steps with recoveries between them. */
export function classifySession(session: DisplaySession | null): SessionVisual {
  if (!session) return { kind: "riposo", ...VISUALS.riposo };
  if (session.sport === "calisthenics") return { kind: "calisthenics", ...VISUALS.calisthenics };
  if (session.sport === "strength_training") return { kind: "forza", ...VISUALS.forza };
  if (session.sport === "cycling") return { kind: "bici", ...VISUALS.bici };

  const steps = effectiveSteps(session);
  const efforts = flattenSteps(steps).filter((s) => s.type === "interval").length;
  if (steps.some(isRepeatBlock) || efforts > 1) return { kind: "ripetute", ...VISUALS.ripetute };
  if (sessionDistanceKm(session) >= LONG_RUN_KM) {
    return { kind: "lungo", ...VISUALS.lungo, illustration: "corsa" };
  }
  return { kind: "fondo_lento", ...VISUALS.fondo_lento };
}

/** 0 for sessions with no step detail (e.g. a live Garmin workout, which only
 * carries date/sport/title -- see `DisplaySession`). Sums every step via
 * `stepDistanceKm` with repeat blocks expanded, so time-based steps
 * (warmup/cooldown/intervals defined in minutes) contribute their pace-estimated
 * distance too and a "6 ×" block counts six times, matching the per-row total shown
 * in the session-detail step list. Steps with no pace of their own are estimated at
 * the session's own slowest pace (see `sessionFallbackPaceSecPerKm`) rather than
 * dropped. */
export function sessionDistanceKm(session: DisplaySession): number {
  if (session.sport === "strength_training" || session.sport === "calisthenics") return 0;
  const steps = effectiveSteps(session);
  if (session.sport === "cycling") {
    return flattenSteps(steps).reduce((sum, s) => {
      if (s.duration_type === "distance") return sum + s.duration_value;
      if (s.type === "rest") return sum;
      return sum + (s.duration_value * 25.0) / 60.0;
    }, 0);
  }
  const fallbackPace = sessionFallbackPaceSecPerKm(steps);
  return flattenSteps(steps).reduce((sum, s) => sum + stepDistanceKm(s, fallbackPace), 0);
}

/** Estimates total duration in minutes of a session. */
export function sessionDurationMinutes(session: DisplaySession): number {
  const steps = effectiveSteps(session);
  if (!steps || steps.length === 0) {
    if (session.min_duration_minutes) return session.min_duration_minutes;
    if (session.sport === "calisthenics" || session.sport === "strength_training") return 45;
    return 30;
  }
  const fallbackPace = sessionFallbackPaceSecPerKm(steps);
  return flattenSteps(steps).reduce((sum, s) => {
    if (s.duration_type === "time") return sum + s.duration_value;
    if (session.sport === "cycling") {
      // 25 km/h -> 2.4 min per km
      return sum + s.duration_value * 2.4;
    }
    const secPerKm = s.target_pace ? (s.target_pace.slower_sec_per_km + s.target_pace.faster_sec_per_km) / 2 : fallbackPace;
    return sum + (s.duration_value * secPerKm) / 60;
  }, 0);
}

export function weekBounds(reference: Date): { start: Date; end: Date } {
  const day = (reference.getDay() + 6) % 7; // Monday = 0
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - day);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return { start, end };
}

/** Local calendar date as YYYY-MM-DD. `d.toISOString()` would convert through UTC
 * first, silently shifting the date for any positive-offset timezone (e.g. a local
 * midnight in Rome is still the previous day in UTC) -- read the local components
 * instead. */
export function toDateKey(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** A YYYY-MM-DD key back as a local-midnight Date, or null if it isn't one.
 *
 * The `T00:00:00` matters: `new Date("2026-08-06")` is parsed as UTC midnight, which in
 * any positive-offset timezone is the *previous* day once read back with local getters --
 * the exact round-trip bug `toDateKey` above avoids in the other direction. */
export function parseDateKey(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const parsed = new Date(`${key}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** How many weeks away from the current one the week containing `key` is (negative for
 * past weeks) -- what Settimana's `?date=` needs to open on a given day's week.
 *
 * Rounded, not floored: the two week starts are both local midnights, so a DST switch
 * between them leaves the difference an hour short of a whole number of days. */
export function weekOffsetFromToday(key: string): number {
  const target = parseDateKey(key);
  if (!target) return 0;
  const targetStart = weekBounds(target).start.getTime();
  const currentStart = weekBounds(new Date()).start.getTime();
  return Math.round((targetStart - currentStart) / (7 * 24 * 60 * 60 * 1000));
}

/** `key` moved by `delta` days, still as a YYYY-MM-DD key. `Date.setDate` rolls over
 * month and year ends on its own, so no bounds check is needed here. */
export function shiftDateKey(key: string, delta: number): string {
  const parsed = parseDateKey(key);
  if (!parsed) return key;
  parsed.setDate(parsed.getDate() + delta);
  return toDateKey(parsed);
}

/** A live Garmin calendar entry has no step detail, so it becomes a session with an
 * empty step list rather than being left out. `nutrition.classify_load` (backend)
 * reads an empty-steps session as "something is planned, just not sized" and answers
 * "facile", never "riposo" -- so a day with a Garmin workout but no imported plan
 * still fuels as a training day instead of silently degrading to rest. */
export function workoutsToSessions(workouts: ScheduledWorkout[]): TrainingSession[] {
  return workouts.map((w) => ({ date: w.date, sport: w.sport as Sport, title: w.title, steps: [] }));
}

/** Whitespace/case-normalized title, used to match a local plan session against its
 * Garmin-side `ScheduledWorkout` (dates alone aren't a unique key -- see callers). */
export function normalizeTitle(title: string): string {
  return title.trim().split(/\s+/).join(" ").toLowerCase();
}

export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
