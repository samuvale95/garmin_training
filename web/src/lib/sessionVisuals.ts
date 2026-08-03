import type { IllustrationName } from "@/components/Illustration";
import type { TrainingSession } from "./types";

export type SessionKind = "riposo" | "ripetute" | "fondo_lento" | "forza" | "lungo";

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
export function classifySession(session: TrainingSession | null): SessionVisual {
  if (!session) return { kind: "riposo", ...VISUALS.riposo };
  if (session.sport === "strength_training") return { kind: "forza", ...VISUALS.forza };
  if (session.sport === "cycling") return { kind: "lungo", ...VISUALS.lungo };
  const hasIntervals = session.steps.some((s) => s.type === "interval");
  if (hasIntervals) return { kind: "ripetute", ...VISUALS.ripetute };
  return { kind: "fondo_lento", ...VISUALS.fondo_lento };
}

export function sessionDistanceKm(session: TrainingSession): number {
  return session.steps
    .filter((s) => s.duration_type === "distance")
    .reduce((sum, s) => sum + s.duration_value, 0);
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

export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
