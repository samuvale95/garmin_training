import { flattenSteps, isRepeatBlock } from "./types";
import type { HrvPoint, PaceTarget, SessionStep, SleepPhases, Step, StepType } from "./types";

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

/** "4:24" -- minutes per km, the only unit a pace is ever *shown* in. Exported so the
 * workout editor can seed its pace fields with the same text the rest of the app
 * displays; `parsePaceMinSec` is its inverse. */
export function formatPaceMinSec(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Parses a minutes-per-km pace typed by hand back into the seconds/km the plan
 * format and the API speak, or null if it isn't one.
 *
 * Accepts "4:40", plus two spellings that are easier on a phone's numeric keypad:
 * "4.40" (the ":" key is a keypress away there) and a bare "5" for a round 5:00.
 * Deliberately stricter than that on the seconds: "4:4" is rejected rather than
 * silently read as 4:04 or 4:40, since only the typist knows which was meant.
 * Mirrors `_parse_pace_token` in training_plan/parser.py, which reads the same
 * M:SS out of the plan file. */
export function parsePaceMinSec(input: string): number | null {
  const trimmed = input.trim();
  if (/^\d{1,2}$/.test(trimmed)) {
    const minutes = Number(trimmed);
    return minutes > 0 ? minutes * 60 : null;
  }
  const match = /^(\d{1,2})[:.'](\d{2})$/.exec(trimmed);
  if (!match) return null;
  const seconds = Number(match[2]);
  if (seconds > 59) return null;
  const total = Number(match[1]) * 60 + seconds;
  return total > 0 ? total : null;
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

const STEP_LABELS_IT: Record<StepType, string> = {
  warmup: "Riscaldamento",
  cooldown: "Defaticamento",
  interval: "Ripetuta",
  recovery: "Recupero",
  rest: "Riposo",
};

/** What each step type actually does on the watch -- shown in the step editor, since
 * the choice is not cosmetic and picking "Riposo" where "Recupero" was meant is
 * exactly how a jogged recovery turns into two minutes of standing still. */
const STEP_HINTS_IT: Record<StepType, string> = {
  warmup: "Apre la seduta. Escluso dalle statistiche delle ripetute.",
  cooldown: "Chiude la seduta. Escluso dalle statistiche delle ripetute.",
  interval: "Il tratto di lavoro.",
  recovery: "Recupero in movimento: dagli un passo target per correre piano.",
  rest: "Pausa da fermo. Il tempo scorre comunque.",
};

export function stepTypeLabel(type: StepType): string {
  return STEP_LABELS_IT[type] ?? type;
}

export function stepTypeHint(type: StepType): string {
  return STEP_HINTS_IT[type] ?? "";
}

/** The two "not the work step" types, which pair with an interval inside a block and
 * are rendered as its "rec ..." rather than as a row of their own. */
function isRecoveryLike(step: Step): boolean {
  return step.type === "recovery" || step.type === "rest";
}

function sameStep(a: Step, b: Step): boolean {
  if (a.type !== b.type) return false;
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
  /** The type of the group's leading step -- what the row is called and coloured by. */
  kind: StepType;
  reps: number;
  /** The group's leading step: the work step of a block, or the lone step itself. */
  step: Step;
  /** The recovery/rest paired with `step`, shown as its "rec ..." instead of a row. */
  recovery: Step | null;
  /** Anything else in a block beyond that pair -- rare, but a block may hold any steps. */
  extra: Step[];
  /** Index in the session's step list this group came from, for React keys. */
  startIndex: number;
}

/** One display row per repeat block or standalone step.
 *
 * A `RepeatBlock` maps straight onto a group, reps and all -- that is the whole point
 * of carrying blocks end to end. Plain steps are still folded together by the old
 * look-alike heuristic (six identical `interval 1km` + `recovery 400m` pairs become
 * one `reps: 6` row), because that is what a workout written before blocks existed --
 * or authored flat in Garmin Connect -- still looks like. */
export function groupSteps(items: SessionStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;
  while (i < items.length) {
    const item = items[i];

    if (isRepeatBlock(item)) {
      const [lead, ...rest] = item.steps;
      if (lead) {
        const recovery = rest[0] && isRecoveryLike(rest[0]) ? rest[0] : null;
        groups.push({
          kind: lead.type,
          reps: item.reps,
          step: lead,
          recovery,
          extra: recovery ? rest.slice(1) : rest,
          startIndex: i,
        });
      }
      i += 1;
      continue;
    }

    if (item.type !== "interval") {
      groups.push({ kind: item.type, reps: 1, step: item, recovery: null, extra: [], startIndex: i });
      i += 1;
      continue;
    }

    // A run of plain steps: look ahead for identical interval(+recovery) repeats.
    const next = items[i + 1];
    const recovery = next && !isRepeatBlock(next) && isRecoveryLike(next) ? next : null;
    const stride = recovery ? 2 : 1;
    let reps = 1;
    let j = i + stride;
    while (j < items.length) {
      const candidate = items[j];
      const candidateRecovery = items[j + 1];
      if (isRepeatBlock(candidate) || candidate.type !== "interval" || !sameStep(candidate, item)) break;
      if (recovery && !(candidateRecovery && !isRepeatBlock(candidateRecovery) && sameStep(candidateRecovery, recovery))) break;
      reps += 1;
      j += stride;
    }
    groups.push({ kind: "interval", reps, step: item, recovery, extra: [], startIndex: i });
    i = j;
  }
  return groups;
}

/** The distance a group stands for in total: every step it holds, once per repetition
 * (time-based steps contributing their pace-estimated distance, see `stepDistanceKm`).
 * `fallbackPace` comes from the whole session, not the group, so the per-row numbers
 * add up to the session total the detail screen shows above them. */
export function groupDistanceKm(group: StepGroup, fallbackPace?: number): number {
  const perRep = [group.step, ...(group.recovery ? [group.recovery] : []), ...group.extra].reduce(
    (sum, step) => sum + stepDistanceKm(step, fallbackPace),
    0
  );
  return group.reps * perRep;
}

/** How long a step lasts, in its own unit: "1000 m" or "15 min". */
export function stepDurationLabel(step: Step): string {
  return step.duration_type === "distance" ? formatDistanceValue(step.duration_value) : `${step.duration_value} min`;
}

/** Label ("6 × 1000 m") and detail ("4:20-4:10 · rec 2 min a 6:30-6:00") for a step
 * group, matching the two-line row the session-detail screen uses. */
export function stepGroupParts(group: StepGroup): { label: string; detail: string } {
  const { step, reps, recovery, extra, kind } = group;
  const times = reps > 1 ? `${reps} × ` : "";

  if (kind === "interval") {
    const pace = step.target_pace ? formatPaceRange(step.target_pace) : "";
    // The recovery's own pace is spelled out too: it is the difference between a
    // jogged recovery and standing still, and the only place the plan says which.
    const rec = recovery
      ? `${stepTypeLabel(recovery.type).toLowerCase()} ${stepDurationLabel(recovery)}${recovery.target_pace ? ` a ${formatPaceRange(recovery.target_pace)}` : ""}`
      : "";
    const rest = extra.map((s) => `${stepTypeLabel(s.type).toLowerCase()} ${stepDurationLabel(s)}`);
    return {
      label: `${times}${stepDurationLabel(step)}`,
      detail: [pace, rec, ...rest].filter(Boolean).join(" · "),
    };
  }

  const pace = step.target_pace ? formatPaceRange(step.target_pace) : "libero";
  return { label: `${times}${stepTypeLabel(kind)}`, detail: `${stepDurationLabel(step)} · ${pace}` };
}

/** One line per group: "6 × 1000 m  4:20-4:10 · rec 400 m", "15 min · libero". */
export function stepGroupLine(group: StepGroup): string {
  const { label, detail } = stepGroupParts(group);
  return detail ? `${label}  ${detail}` : label;
}

/** Compact arrow-joined summary for diff/deletion cards: "WU 15' → 6×1km @4:20-4:10 → CD 10'". */
export function planStepsSummary(steps: SessionStep[]): string {
  const abbrev: Partial<Record<StepType, string>> = { warmup: "WU", cooldown: "CD", recovery: "rec", rest: "rip" };
  const compact = (step: Step) =>
    step.duration_type === "distance" ? formatDistanceValue(step.duration_value).replace(" ", "") : `${step.duration_value}'`;

  return groupSteps(steps)
    .map((group) => {
      const { step, reps, kind } = group;
      if (kind === "interval") {
        const pace = step.target_pace ? ` @${formatPaceRange(step.target_pace)}` : "";
        return `${reps > 1 ? `${reps}×` : ""}${compact(step)}${pace}`;
      }
      return `${reps > 1 ? `${reps}×` : ""}${abbrev[kind] ?? kind} ${compact(step)}`;
    })
    .join(" → ");
}

/** Stand-in pace for a time-based step that names none and sits in a session that
 * names none either. 6:00/km: an unhurried running pace, chosen because the steps
 * that go unpaced in practice are warmups, cooldowns and jogged recoveries. */
export const DEFAULT_EASY_PACE_SEC_PER_KM = 360;

function avgPaceSecPerKm(target: PaceTarget): number {
  return (target.slower_sec_per_km + target.faster_sec_per_km) / 2;
}

/** The pace to assume for the steps of `steps` that carry no target of their own:
 * the slowest one the session *does* name. The unpaced steps are the easy parts of
 * a session, so the session's slowest named pace is the closest honest proxy --
 * borrowing the interval pace would turn a 15-minute warmup into 3.7 km. Falls back
 * to `DEFAULT_EASY_PACE_SEC_PER_KM` for a session with no pace anywhere. */
export function sessionFallbackPaceSecPerKm(steps: SessionStep[]): number {
  const paces = flattenSteps(steps)
    .map((s) => (s.target_pace ? avgPaceSecPerKm(s.target_pace) : null))
    .filter((p): p is number => p != null);
  return paces.length > 0 ? Math.max(...paces) : DEFAULT_EASY_PACE_SEC_PER_KM;
}

/** Best-effort km-equivalent of a single step, for screens that show a per-step
 * distance even for time-based warmup/cooldown steps -- derived from the step's own
 * pace target when present (no new backend data needed), and from `fallbackPace`
 * when absent.
 *
 * The fallback matters: a time-based step with no pace used to count as 0 km, which
 * silently understated every total built on top of this -- the weekly km on Oggi and
 * Settimana, the "previsto" bars on Carico -- for anyone who writes "riscaldamento:
 * 15 min" without a target, which is how most plans are written. An estimate the
 * screens label as planned volume is right; a zero is wrong.
 *
 * `rest` is the one step that really is 0 km: it is time spent standing still. */
export function stepDistanceKm(step: Step, fallbackPace = DEFAULT_EASY_PACE_SEC_PER_KM): number {
  if (step.duration_type === "distance") return step.duration_value;
  if (step.type === "rest") return 0;
  const secPerKm = step.target_pace ? avgPaceSecPerKm(step.target_pace) : fallbackPace;
  return (step.duration_value * 60) / secPerKm;
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
export function sessionDetailLine(session: { steps?: SessionStep[]; description?: string | null }): string {
  const steps = session.steps ?? [];
  const groups = groupSteps(steps).filter((g) => g.kind !== "warmup" && g.kind !== "cooldown");
  if (groups.length > 0) return groups.map(stepGroupLine).join(" · ");
  return session.description ?? "";
}
