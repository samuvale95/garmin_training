import type { HrvPoint, PaceTarget, SleepPhases, Step } from "./types";

// ---- Italian number words --------------------------------------------------------------
// The design spells out small counts in headlines ("Sei differenze", "Settimana
// trentatré") rather than using digits -- covers the ranges we actually hit (week
// numbers 1-53, diff/deletion counts, typically well under 100).

const UNITS = [
  "zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove",
  "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici",
  "diciassette", "diciotto", "diciannove",
];
const TENS = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];

export function numberToItalianWords(n: number): string {
  if (n < 0 || !Number.isInteger(n) || n >= 100) return String(n);
  if (n < 20) return UNITS[n];
  const tensDigit = Math.floor(n / 10);
  const unit = n % 10;
  let tensWord = TENS[tensDigit];
  if (unit === 0) return tensWord;
  // "venti" + "uno"/"otto" elides the tens word's final vowel: "ventuno", "ventotto".
  if (unit === 1 || unit === 8) tensWord = tensWord.slice(0, -1);
  const unitWord = unit === 3 ? "tré" : UNITS[unit];
  return tensWord + unitWord;
}

export function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

// ---- dates ------------------------------------------------------------------------------

/** "mar 11" -- weekday abbreviation + day number, the format the design uses on
 * every session/date row (screens 04, 05, 09). */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr);
  const weekday = d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "");
  return `${weekday} ${d.getDate()}`;
}

export function formatWeekday(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("it-IT", { weekday: "long" });
}

/** Minutes since `isoTimestamp`, floored at 0. A plain (non-component) function, so
 * the render-purity lint rule doesn't flag its `Date.now()` call the way it would if
 * it were written directly in a component body. */
export function minutesAgo(isoTimestamp: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 60_000));
}

/** "1'46″" -- minutes/seconds, the format the design uses for a sync job's duration. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}'${String(seconds).padStart(2, "0")}″`;
}

// ---- pace / step formatting -------------------------------------------------------------

function formatPaceMinSec(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** "4:24/km" -- a single (not ranged) pace, the format screen 17 uses for an actual
 * (Strava-reported) pace rather than a planned range. */
export function formatPaceValue(secondsPerKm: number): string {
  return `${formatPaceMinSec(secondsPerKm)}/km`;
}

/** "4:20-4:10" -- slower bound first, matching how the design always presents a
 * pace range (and the on-disk YAML convention `formatPace` in planYaml.ts mirrors). */
export function formatPaceRange(target: PaceTarget): string {
  return `${formatPaceMinSec(target.slower_sec_per_km)}-${formatPaceMinSec(target.faster_sec_per_km)}`;
}

function formatDistanceValue(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km % 1 === 0 ? km : km.toFixed(1)} km`;
}

const STEP_LABELS_IT: Record<Step["type"], string> = {
  warmup: "Riscaldamento",
  cooldown: "Defaticamento",
  recovery: "Recupero",
  interval: "Ripetuta",
};

export function stepTypeLabel(type: Step["type"]): string {
  return STEP_LABELS_IT[type] ?? type;
}

function sameStep(a: Step, b: Step): boolean {
  if (a.duration_type !== b.duration_type || a.duration_value !== b.duration_value) return false;
  if (!a.target_pace !== !b.target_pace) return false;
  if (a.target_pace && b.target_pace) {
    return (
      a.target_pace.slower_sec_per_km === b.target_pace.slower_sec_per_km &&
      a.target_pace.faster_sec_per_km === b.target_pace.faster_sec_per_km
    );
  }
  return true;
}

export interface StepGroup {
  /** null for a lone warmup/cooldown row. */
  kind: "interval" | "warmup" | "cooldown" | "recovery";
  reps: number;
  step: Step;
  recovery: Step | null;
  /** Index range in the original steps array this group spans, for React keys. */
  startIndex: number;
}

/** Groups consecutive identical interval(+recovery) pairs into reps, e.g. six
 * `interval 1km @4:20-4:10` + `recovery 400m` pairs in a row become one group with
 * `reps: 6` -- the shape the design always shows ("6 × 1000 m ... rec 400 m"), never
 * six separate rows. */
export function groupSteps(steps: Step[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    if (step.type !== "interval") {
      groups.push({ kind: step.type, reps: 1, step, recovery: null, startIndex: i });
      i += 1;
      continue;
    }
    const recovery = steps[i + 1]?.type === "recovery" ? steps[i + 1] : null;
    const stride = recovery ? 2 : 1;
    let reps = 1;
    let j = i + stride;
    while (
      j < steps.length &&
      steps[j].type === "interval" &&
      sameStep(steps[j], step) &&
      (!recovery || (steps[j + 1]?.type === "recovery" && sameStep(steps[j + 1], recovery)))
    ) {
      reps += 1;
      j += stride;
    }
    groups.push({ kind: "interval", reps, step, recovery, startIndex: i });
    i = j;
  }
  return groups;
}

/** Label ("6 × 1000 m") and detail ("4:20-4:10 · rec 400 m") for a step group,
 * matching the two-line row the session-detail screen uses. */
export function stepGroupParts(group: StepGroup): { label: string; detail: string } {
  const { step, reps, recovery, kind } = group;
  if (kind === "interval") {
    const distance = step.duration_type === "distance" ? formatDistanceValue(step.duration_value) : `${step.duration_value} min`;
    const label = reps > 1 ? `${reps} × ${distance}` : distance;
    const pace = step.target_pace ? formatPaceRange(step.target_pace) : "";
    const rec = recovery
      ? `rec ${recovery.duration_type === "distance" ? formatDistanceValue(recovery.duration_value) : `${recovery.duration_value} min`}`
      : "";
    return { label, detail: [pace, rec].filter(Boolean).join(" · ") };
  }
  const duration = step.duration_type === "time" ? `${step.duration_value} min` : formatDistanceValue(step.duration_value);
  return { label: stepTypeLabel(kind), detail: `${duration} · libero` };
}

/** One line per group: "6 × 1000 m  4:20-4:10 · rec 400 m", "15 min · libero". */
export function stepGroupLine(group: StepGroup): string {
  const { label, detail } = stepGroupParts(group);
  return detail ? `${label}  ${detail}` : label;
}

/** Compact arrow-joined summary for diff/deletion cards: "WU 15' → 6×1km @4:20-4:10 → CD 10'". */
export function planStepsSummary(steps: Step[]): string {
  const abbrev: Partial<Record<Step["type"], string>> = { warmup: "WU", cooldown: "CD" };
  return groupSteps(steps)
    .map((group) => {
      const { step, reps, kind } = group;
      if (kind === "interval") {
        const distance = step.duration_type === "distance" ? formatDistanceValue(step.duration_value).replace(" ", "") : `${step.duration_value}'`;
        const pace = step.target_pace ? ` @${formatPaceRange(step.target_pace)}` : "";
        return `${reps > 1 ? `${reps}×` : ""}${distance}${pace}`;
      }
      const value = step.duration_type === "time" ? `${step.duration_value}'` : formatDistanceValue(step.duration_value).replace(" ", "");
      return `${abbrev[kind] ?? kind} ${value}`;
    })
    .join(" → ");
}

/** Best-effort km-equivalent of a single step, for screens that show a per-step
 * distance even for time-based warmup/cooldown steps -- derived from the step's own
 * pace target when present (no new backend data needed), 0 when it can't be inferred. */
export function stepDistanceKm(step: Step): number {
  if (step.duration_type === "distance") return step.duration_value;
  if (step.target_pace) {
    const avgSecPerKm = (step.target_pace.slower_sec_per_km + step.target_pace.faster_sec_per_km) / 2;
    return (step.duration_value * 60) / avgSecPerKm;
  }
  return 0;
}

/** "oggi" / "domani" / a weekday name, relative to `today` -- the eyebrow label the
 * design puts on a preview of an upcoming session (today's hero card, body-conflict). */
export function relativeDayLabel(dateStr: string, today: Date): string {
  const target = new Date(dateStr);
  const diffDays = Math.round((target.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 0) return "oggi";
  if (diffDays === 1) return "domani";
  return new Date(dateStr).toLocaleDateString("it-IT", { weekday: "long" });
}

/** "mercoledì 11 agosto" -- full weekday + day + month, for hero/preview cards. */
export function formatFullDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
}

// ---- body-insight captions ----------------------------------------------------------------
// Small qualitative labels derived client-side from thresholds -- the same pattern the
// body screens already used for readiness ("Pronto a lavorare" vs "Vacci piano oggi"),
// applied to the other body-conflict/come-stai metrics so they read the same way.

export function stressCaption(level: number | null): string | null {
  if (level == null) return null;
  if (level < 25) return "notte calma";
  if (level < 50) return "nella norma";
  return "sopra la norma";
}

export function hrvCaption(current: number | null, sevenDay: HrvPoint[]): string | null {
  if (current == null) return null;
  const values = sevenDay.map((p) => p.value_ms).filter((v): v is number => v != null);
  if (values.length < 2) return null;
  const baseline = values.reduce((sum, v) => sum + v, 0) / values.length;
  return current < baseline * 0.9 ? "sotto la norma" : current > baseline * 1.1 ? "sopra la norma" : "nella tua norma";
}

export function sleepCaption(sleep: SleepPhases | null): string | null {
  if (!sleep || sleep.total_minutes == null) return null;
  if (sleep.total_minutes < 360) return "frammentato";
  if (sleep.awake_minutes != null && sleep.awake_minutes > 40) return "frammentato";
  return "regolare";
}

/** One-line "what's actually in this session" note for the week view's day cards --
 * pace/duration/recovery pulled straight from the plan's own steps, replacing the
 * generic category label ("Ripetute") the day card used to fall back to. */
export function sessionDetailLine(session: { steps?: Step[]; description?: string | null }): string {
  const steps = session.steps ?? [];
  const groups = groupSteps(steps).filter((g) => g.kind !== "warmup" && g.kind !== "cooldown");
  if (groups.length > 0) return groups.map(stepGroupLine).join(" · ");
  return session.description ?? "";
}
