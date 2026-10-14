import { formatMinutes } from "./format";
import type { BodySnapshot } from "./types";

/** The morning numbers, each already judged.
 *
 * Corpo used to print every figure in the same ink with its norm in small type under it,
 * and left the comparison to the reader: five numbers, five norms, one of them mattering.
 * Here each number carries a verdict (ok / keep an eye on it / out of range) and a
 * colour that says it before the number is read, so the screen can lead with the ones
 * that are off and let the rest be a single "nella norma". */
export type SignalStatus = "ok" | "attenzione" | "allerta";

export type SignalKey = "sonno" | "hrv" | "cuore" | "battery" | "stress";

export interface BodySignal {
  key: SignalKey;
  label: string;
  value: string;
  unit?: string;
  status: SignalStatus;
  /** Two or three words: "più alto del solito", "riserva bassa", "nella norma". */
  verdict: string;
}

/** One palette for every verdict on the screen: green, amber, coral. `stroke` is for
 * rings, bars and dots; `bg`/`text` for the tinted surfaces and their ink. */
export const STATUS_STYLE: Record<SignalStatus, { bg: string; text: string; stroke: string; edge: string }> = {
  ok: { bg: "var(--verde)", text: "var(--verde-testo)", stroke: "var(--verde-tratto-scuro)", edge: "rgba(76, 122, 42, 0.28)" },
  attenzione: { bg: "var(--giallo)", text: "var(--giallo-testo)", stroke: "var(--rosso-avviso)", edge: "rgba(179, 74, 32, 0.3)" },
  allerta: { bg: "var(--corallo-chiaro)", text: "var(--corallo-testo)", stroke: "var(--corallo-accent)", edge: "rgba(217, 45, 85, 0.35)" },
};

const SEVERITY: Record<SignalStatus, number> = { allerta: 0, attenzione: 1, ok: 2 };

// Readiness: the same cut the verdict line uses ("Pronto a lavorare" from 65 up).
const READY_SCORE = 65;
const CAREFUL_SCORE = 50;
// Sleep: Garmin's own score when there is one, otherwise the hours.
const SLEEP_SCORE_OK = 75;
const SLEEP_SCORE_SHORT = 60;
const SLEEP_MINUTES_OK = 7 * 60;
const SLEEP_MINUTES_SHORT = 6 * 60;
// HRV against the other nights of the week, when there is no personal norm yet.
const HRV_DROP_ALERT_PCT = -10;
const HRV_DROP_WATCH_PCT = -5;
// Resting heart rate against the 7-day mean, when there is no personal norm yet.
const RHR_DELTA_ALERT = 5;
const RHR_DELTA_WATCH = 3;
// Body Battery: below a third the rest of the day is thin.
export const LOW_BATTERY_PERCENT = 30;
const HALF_BATTERY_PERCENT = 50;
// Garmin's stress scale: 50 and up is "medium" stress, at rest that is a lot.
export const HIGH_STRESS = 50;

export function readinessStatus(score: number | null): SignalStatus {
  if (score == null || score >= READY_SCORE) return "ok";
  return score >= CAREFUL_SCORE ? "attenzione" : "allerta";
}

/** Last night's HRV against the six nights before it, in percent. */
export function hrvDeltaPct(data: Pick<BodySnapshot, "hrv_seven_day" | "hrv_last_night_ms">): number | null {
  const values = data.hrv_seven_day.map((p) => p.value_ms).filter((v): v is number => v != null);
  const earlier = values.slice(0, -1);
  if (earlier.length === 0 || data.hrv_last_night_ms == null) return null;
  const baseline = earlier.reduce((sum, v) => sum + v, 0) / earlier.length;
  return Math.round(((data.hrv_last_night_ms - baseline) / baseline) * 100);
}

function sleepSignal(data: BodySnapshot): BodySignal | null {
  const sleep = data.sleep;
  if (!sleep?.total_minutes) return null;
  const status: SignalStatus =
    sleep.score != null
      ? sleep.score >= SLEEP_SCORE_OK ? "ok" : sleep.score >= SLEEP_SCORE_SHORT ? "attenzione" : "allerta"
      : sleep.total_minutes >= SLEEP_MINUTES_OK ? "ok" : sleep.total_minutes >= SLEEP_MINUTES_SHORT ? "attenzione" : "allerta";
  const verdict = sleep.score_label?.toLowerCase() ?? (status === "ok" ? "buono" : status === "attenzione" ? "un po' corto" : "troppo corto");
  return { key: "sonno", label: "Sonno", value: formatMinutes(sleep.total_minutes), status, verdict };
}

function hrvSignal(data: BodySnapshot): BodySignal | null {
  const ms = data.hrv_last_night_ms;
  if (ms == null) return null;
  const norm = data.hrv_norm;
  if (norm?.has_personal_norm) {
    const low = ms < norm.normal_min;
    return { key: "hrv", label: "HRV", value: `${ms}`, unit: "ms", status: low ? "allerta" : "ok", verdict: low ? "sotto la tua norma" : "nella norma" };
  }
  const delta = hrvDeltaPct(data);
  if (delta == null) return { key: "hrv", label: "HRV", value: `${ms}`, unit: "ms", status: "ok", verdict: "stanotte" };
  const status: SignalStatus = delta <= HRV_DROP_ALERT_PCT ? "allerta" : delta <= HRV_DROP_WATCH_PCT ? "attenzione" : "ok";
  return { key: "hrv", label: "HRV", value: `${ms}`, unit: "ms", status, verdict: status === "ok" ? "nella media" : `${delta}% sulla media` };
}

function heartSignal(data: BodySnapshot): BodySignal | null {
  const bpm = data.resting_heart_rate;
  if (bpm == null) return null;
  const norm = data.rhr_norm;
  const delta = data.resting_heart_rate_delta ?? 0;
  const status: SignalStatus = norm?.has_personal_norm
    ? bpm > norm.normal_max ? "allerta" : "ok"
    : delta >= RHR_DELTA_ALERT ? "allerta" : delta >= RHR_DELTA_WATCH ? "attenzione" : "ok";
  const verdict = status === "allerta" ? "più alto del solito" : status === "attenzione" ? "un po' alto" : "nella norma";
  return { key: "cuore", label: "Cuore a riposo", value: `${bpm}`, unit: "bpm", status, verdict };
}

function batterySignal(data: BodySnapshot): BodySignal | null {
  const pct = data.battery_percent;
  if (pct == null) return null;
  const status: SignalStatus = pct < LOW_BATTERY_PERCENT ? "allerta" : pct < HALF_BATTERY_PERCENT ? "attenzione" : "ok";
  const verdict = status === "allerta" ? "riserva bassa" : status === "attenzione" ? "a metà" : "carica";
  return { key: "battery", label: "Body Battery", value: `${pct}%`, status, verdict };
}

function stressSignal(data: BodySnapshot): BodySignal | null {
  const level = data.stress_level;
  if (level == null) return null;
  const high = level >= HIGH_STRESS;
  return { key: "stress", label: "Stress", value: `${level}`, unit: "/100", status: high ? "allerta" : "ok", verdict: high ? "sopra la norma" : level < 25 ? "basso" : "nella norma" };
}

/** Every signal there is data for, worst first (ties keep the order sleep, HRV, heart,
 * battery, stress). */
export function bodySignals(data: BodySnapshot): BodySignal[] {
  return [sleepSignal(data), hrvSignal(data), heartSignal(data), batterySignal(data), stressSignal(data)]
    .filter((s): s is BodySignal => s != null)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => SEVERITY[a.s.status] - SEVERITY[b.s.status] || a.i - b.i)
    .map(({ s }) => s);
}
