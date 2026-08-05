import type { IllustrationName } from "@/components/Illustration";
import { stepDistanceKm } from "./format";
import type { Step } from "./types";

export type SessionKind = "riposo" | "ripetute" | "fondo_lento" | "forza" | "lungo";

/** Shared shape for anything rendered on Oggi/Settimana -- an imported plan's
 * `TrainingSession` (steps present, distance/interval-aware) or a raw Garmin
 * `ScheduledWorkout` (steps absent, only date/sport/title) both satisfy this
 * structurally, so the calendar screens don't need separate render paths. */
export interface DisplaySession {
  date: string;
  sport: string;
  title: string;
  steps?: Step[];
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
  fondo_lento: { label: "Fondo lento", background: "var(--azzurro)", foreground: "var(--azzurro-testo)", illustration: null },
  forza: { label: "Forza", background: "var(--lilla)", foreground: "var(--lilla-testo)", illustration: "forza" },
  lungo: { label: "Lungo", background: "var(--verde)", foreground: "var(--verde-testo)", illustration: "bici" },
};

/** Classifies a session into the design's five day-card types. The file format only
 * carries sport + steps, not an explicit category, so this is a heuristic -- good
 * enough to drive card color/illustration, not a source of truth about training
 * intent. */
export function classifySession(session: DisplaySession | null): SessionVisual {
  if (!session) return { kind: "riposo", ...VISUALS.riposo };
  if (session.sport === "strength_training") return { kind: "forza", ...VISUALS.forza };
  if (session.sport === "cycling") return { kind: "lungo", ...VISUALS.lungo };
  const hasIntervals = session.steps?.some((s) => s.type === "interval") ?? false;
  if (hasIntervals) return { kind: "ripetute", ...VISUALS.ripetute };
  return { kind: "fondo_lento", ...VISUALS.fondo_lento };
}

/** 0 for sessions with no step detail (e.g. a live Garmin workout, which only
 * carries date/sport/title -- see `DisplaySession`). Sums every step via
 * `stepDistanceKm`, so time-based steps (warmup/cooldown/intervals defined in
 * minutes) contribute their pace-estimated distance too, matching the per-row
 * total shown in the session-detail step list. */
export function sessionDistanceKm(session: DisplaySession): number {
  return (session.steps ?? []).reduce((sum, s) => sum + stepDistanceKm(s), 0);
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
