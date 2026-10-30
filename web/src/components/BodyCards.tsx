"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { SlideUp } from "@/components/motion/primitives";
import { Illustration } from "@/components/Illustration";
import type { ReactNode } from "react";
import { MoonIcon, PulseIcon } from "@/components/Icons";
import { formatMinutes, weekdayInitial } from "@/lib/format";
import { STATUS_STYLE, type BodySignal, type SignalStatus } from "@/lib/bodySignals";
import type { HrvPoint, ReadinessFactor, SleepPhases } from "@/lib/types";

// The three cards on "Come stai" that had numbers but no meaning: a sleep total with
// one phase under it, a readiness score with an untranslated Garmin key under it, and a
// bar chart with nothing saying what the bars were.
//
// The rule they are rewritten to: every figure on this screen names its unit, its
// reference, and what it is for. A number a person cannot act on is decoration.

// ---- sleep -----------------------------------------------------------------------------

/** The four phases, with the share of the night each one should be.
 *
 * The reference bands are the usual adult ones (deep 13-23%, REM 20-25%, light the
 * remainder, awake under 10%) and they are on screen next to the measurement for the
 * same reason every other band in this app is: so "1h24 of deep sleep" stops being a
 * number you have to have an opinion about. */
const SLEEP_PHASES: { key: keyof SleepPhases; label: string; color: string; share: string }[] = [
  { key: "deep_minutes", label: "Profondo", color: "var(--azzurro-testo)", share: "13-23% della notte" },
  { key: "rem_minutes", label: "REM", color: "var(--lilla)", share: "20-25% della notte" },
  { key: "light_minutes", label: "Leggero", color: "var(--azzurro)", share: "il resto" },
  { key: "awake_minutes", label: "Sveglio", color: "var(--giallo)", share: "sotto il 10%" },
];

const PHASE_MEANING: Record<string, string> = {
  deep_minutes: "è la fase in cui il corpo ripara: poco profondo e le gambe se ne accorgono",
  rem_minutes: "è la fase in cui la testa archivia: poca REM e la seduta dura sembra più dura",
  light_minutes: "la parte più lunga della notte, quella che riempie fra le altre due",
  awake_minutes: "i risvegli, anche quelli che non ricordi",
};

function phaseMinutes(sleep: SleepPhases, key: keyof SleepPhases): number | null {
  const value = sleep[key];
  return typeof value === "number" ? value : null;
}

// Below these shares of the night a phase is marked short; above the awake one, long.
const DEEP_MIN_PCT = 13;
const REM_MIN_PCT = 20;
const AWAKE_MAX_PCT = 10;

function phaseIsOff(key: keyof SleepPhases, pct: number): boolean {
  if (key === "deep_minutes") return pct < DEEP_MIN_PCT;
  if (key === "rem_minutes") return pct < REM_MIN_PCT;
  if (key === "awake_minutes") return pct > AWAKE_MAX_PCT;
  return false;
}

/** A verdict as a coloured pill: the first thing on a card, so the card's point is read
 * before its numbers. */
export function StatusPill({ status, children }: { status: SignalStatus; children: ReactNode }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: style.bg,
        color: style.text,
        borderRadius: "var(--radius-pill)",
        padding: "3px 9px",
        fontSize: 12.5,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: style.stroke }} />
      {children}
    </span>
  );
}

/** "What is this" text, folded away: it is read once, and after that it is in the way. */
export function Explainer({ track, label = "Cos'è?", children }: { track: string; label?: string; children: ReactNode }) {
  return (
    <details className="body-explainer">
      <summary data-track={track}>{label}</summary>
      <p>{children}</p>
    </details>
  );
}

export function SleepCard({
  sleep,
  animate,
  delayMs,
  signal,
}: {
  sleep: SleepPhases;
  animate: boolean;
  delayMs: number;
  signal?: BodySignal | null;
}) {
  const total = sleep.total_minutes ?? 0;
  // The bar is drawn over the phases that were actually measured, not over the night's
  // total: the two differ by a few minutes on most nights, and a bar that does not
  // fill is a bug the user has to explain to themselves.
  const measured = SLEEP_PHASES.reduce((sum, phase) => sum + (phaseMinutes(sleep, phase.key) ?? 0), 0) || 1;

  return (
    <SlideUp active={animate} delayMs={delayMs}>
      <motion.div
        whileHover={{ y: -3, scale: 1.012 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        style={{
          background: "var(--crema-card)",
          color: "var(--inchiostro)",
          border: "var(--border-airbnb)",
          boxShadow: "var(--shadow-airbnb-subtle)",
          borderRadius: "var(--radius-card)",
          padding: 16,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--azzurro)", color: "var(--azzurro-testo)", display: "grid", placeItems: "center" }}>
              <MoonIcon size={15} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Sonno</span>
          </span>
          {signal && (
            <StatusPill status={signal.status}>
              {sleep.score != null ? `${sleep.score}/100 · ` : ""}
              {signal.verdict}
            </StatusPill>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 10 }}>
          <span className="font-mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>{formatMinutes(total)}</span>
          <span style={{ fontSize: 12.5, color: "var(--inchiostro-50)" }}>dormite</span>
        </div>

        <Illustration name="sonno" width={52} height={52} right={14} top={44} active={animate} delayMs={delayMs + 80} />

        <div style={{ display: "flex", height: 10, borderRadius: 100, overflow: "hidden", marginTop: 12, gap: 2 }}>
          {SLEEP_PHASES.map((phase) => {
            const minutes = phaseMinutes(sleep, phase.key) ?? 0;
            return <div key={phase.key} style={{ width: `${(minutes / measured) * 100}%`, background: phase.color, borderRadius: 2 }} />;
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          {SLEEP_PHASES.map((phase) => {
            const minutes = phaseMinutes(sleep, phase.key);
            if (minutes == null) return null;
            const pct = Math.round((minutes / measured) * 100);
            const off = phaseIsOff(phase.key, pct);
            return (
              <div
                key={phase.key}
                style={{
                  borderRadius: "var(--radius-sm)",
                  padding: "8px 10px",
                  background: off ? STATUS_STYLE.attenzione.bg : "var(--sabbia)",
                  borderLeft: `3px solid ${phase.color}`,
                }}
              >
                <p style={{ fontSize: 12.5, fontWeight: 600, margin: 0, color: off ? STATUS_STYLE.attenzione.text : "var(--inchiostro-70)" }}>{phase.label}</p>
                <p className="font-mono" style={{ fontSize: 15, fontWeight: 600, margin: "2px 0 0" }}>
                  {formatMinutes(minutes)}
                  <span style={{ fontSize: 12, fontWeight: 400, color: off ? STATUS_STYLE.attenzione.text : "var(--inchiostro-50)" }}>
                    {" "}· {pct}%{off ? (phase.key === "awake_minutes" ? " alto" : " basso") : ""}
                  </span>
                </p>
              </div>
            );
          })}
        </div>

        <Explainer track="body.sleep-explainer">
          Di solito il sonno profondo è il {SLEEP_PHASES[0].share} e la REM il {SLEEP_PHASES[1].share}; da sveglio{" "}
          {SLEEP_PHASES[3].share}. Il profondo ripara i muscoli, la REM consolida: se uno dei due è basso la seduta dura
          pesa di più.
        </Explainer>
      </motion.div>
    </SlideUp>
  );
}

/** The phase breakdown, in prose, for the screen that has room to explain it. */
export function SleepPhaseLegend({ sleep }: { sleep: SleepPhases }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {SLEEP_PHASES.map((phase) => {
        const minutes = phaseMinutes(sleep, phase.key);
        if (minutes == null) return null;
        return (
          <motion.div
            key={phase.key}
            whileHover={{ y: -2, scale: 1.01 }}
            transition={{ type: "spring", stiffness: 400, damping: 25 }}
            style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "13px 16px", border: "var(--border-airbnb)", boxShadow: "var(--shadow-airbnb-subtle)" }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600, fontSize: 14.5 }}>
                <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: phase.color }} />
                {phase.label}
              </span>
              <span className="font-mono" style={{ fontSize: 13.5 }}>{formatMinutes(minutes)}</span>
            </div>
            <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.35 }}>
              {PHASE_MEANING[phase.key as string]}
            </p>
            <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "5px 0 0" }}>
              di solito {phase.share}
            </p>
          </motion.div>
        );
      })}
    </div>
  );
}

// ---- HRV ---------------------------------------------------------------------------------

const HRV_CHART_HEIGHT = 46;

/** Seven nights of heart-rate variability, with the thing the bars are compared against
 * drawn on top of them.
 *
 * The chart used to be seven unlabelled bars: no axis, no baseline, no units, and no
 * way to tell which one was tonight. What makes it readable is the dashed line -- the
 * average of the other six nights, which is the only number tonight's bar means
 * anything against. */
export function HrvCard({
  points,
  lastNight,
  animate,
  delayMs,
  norm,
  signal,
}: {
  points: HrvPoint[];
  lastNight: number | null;
  animate: boolean;
  delayMs: number;
  norm?: import("@/lib/types").BiometricNorm | null;
  signal?: BodySignal | null;
}) {
  const values = points.map((p) => p.value_ms).filter((v): v is number => v != null);
  const hasNorm = norm?.has_personal_norm ?? false;
  const max = Math.max(...values, hasNorm && norm ? norm.normal_max : 0, 1);
  // The axis starts a little under the lowest night, not at zero: nights between 41 and
  // 47 ms drawn from zero are seven equal bars, and the drop is the whole point.
  const lowest = Math.min(...values, hasNorm && norm ? norm.normal_min : Infinity);
  const floor = Number.isFinite(lowest) ? Math.max(0, lowest - (max - lowest) * 0.6 - 2) : 0;
  const scale = (v: number) => (Math.max(0, v - floor) / Math.max(1, max - floor)) * HRV_CHART_HEIGHT;
  const earlier = values.slice(0, -1);
  const baseline = earlier.length > 0 ? earlier.reduce((sum, v) => sum + v, 0) / earlier.length : null;
  const lastColor = STATUS_STYLE[signal?.status ?? "ok"].stroke;

  return (
    <SlideUp active={animate} delayMs={delayMs}>
      <motion.div
        whileHover={{ y: -3, scale: 1.012 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
        style={{
          background: "var(--crema-card)",
          border: "var(--border-airbnb)",
          boxShadow: "var(--shadow-airbnb-subtle)",
          borderRadius: "var(--radius-card)",
          padding: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span aria-hidden="true" style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--lilla)", color: "var(--lilla-testo)", display: "grid", placeItems: "center" }}>
              <PulseIcon size={15} />
            </span>
            <span style={{ fontSize: 14, fontWeight: 700 }}>Variabilità cardiaca</span>
          </span>
          {signal && <StatusPill status={signal.status}>{signal.verdict}</StatusPill>}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 10 }}>
          <span className="font-mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: "-.02em" }}>{lastNight ?? "—"}</span>
          <span style={{ fontSize: 12.5, color: "var(--inchiostro-50)" }}>ms stanotte</span>
          <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", marginLeft: "auto" }}>
            {hasNorm && norm
              ? `norma ${Math.round(norm.normal_min)}–${Math.round(norm.normal_max)}`
              : baseline != null
                ? `media ${Math.round(baseline)}`
                : ""}
          </span>
        </div>

        <div style={{ position: "relative", height: HRV_CHART_HEIGHT, marginTop: 14 }}>
          {hasNorm && norm ? (
            <div
              aria-hidden="true"
              title={`Norma personale: ${Math.round(norm.normal_min)}–${Math.round(norm.normal_max)} ms`}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${scale(norm.normal_min)}px`,
                height: `${Math.max(4, scale(norm.normal_max) - scale(norm.normal_min))}px`,
                background: "rgba(46,125,50,0.08)",
                borderTop: "1px dashed rgba(46,125,50,0.35)",
                borderBottom: "1px dashed rgba(46,125,50,0.35)",
                borderRadius: 2,
              }}
            />
          ) : baseline != null ? (
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${scale(baseline)}px`,
                borderTop: "1px dashed var(--inchiostro-35)",
              }}
            />
          ) : null}
          <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
            {points.map((point, i) => {
              const isLast = i === points.length - 1;
              const value = point.value_ms;
              return (
                <motion.div
                  key={point.date}
                  whileHover={{ scaleY: 1.15, y: -2 }}
                  transition={{ type: "spring", stiffness: 400, damping: 20 }}
                  title={`${point.value_ms ?? "—"} ms`}
                  style={{
                    flex: 1,
                    height: `${value == null ? 3 : Math.max(5, scale(value))}px`,
                    background: isLast ? lastColor : "var(--neutro-barra)",
                    borderRadius: 3,
                    transformOrigin: "bottom",
                  }}
                />
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          {points.map((point, i) => (
            <span
              key={point.date}
              className="font-mono"
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: 12,
                color: i === points.length - 1 ? "var(--inchiostro)" : "var(--inchiostro-35)",
                fontWeight: i === points.length - 1 ? 700 : 400,
              }}
            >
              {weekdayInitial(point.date)}
            </span>
          ))}
        </div>

        <Explainer track="body.hrv-explainer">
          Una barra per notte, l&apos;ultima è stanotte; la linea tratteggiata è la tua media. È quanto varia la distanza
          fra un battito e l&apos;altro mentre dormi: sale quando sei recuperato, scende quando il corpo sta ancora
          lavorando. Conta solo rispetto alla tua media, mai a quella di altri.
        </Explainer>
      </motion.div>
    </SlideUp>
  );
}

// ---- readiness -----------------------------------------------------------------------------

/** What "64" is out of, and what it is made of.
 *
 * The score arrived on screen as a bare number with a Garmin lookup key under it
 * (`MOD_RT_LOW_SS_GOOD`). The key is decoded server-side now; this is the other half --
 * the bands the number falls in, and the inputs behind it. */
export const READINESS_BANDS: { upper: number; label: string; meaning: string }[] = [
  { upper: 25, label: "molto bassa", meaning: "il corpo non ha recuperato: oggi allenarsi costa più di quanto renda" },
  { upper: 50, label: "bassa", meaning: "si può muoversi, ma non è la giornata per cercare la seduta dura" },
  { upper: 75, label: "media", meaning: "il piano regge, senza cercare di strafare" },
  { upper: 101, label: "alta", meaning: "il corpo è pronto: se c'è una seduta impegnativa, è oggi" },
];

export function readinessBand(score: number) {
  return READINESS_BANDS.find((band) => score < band.upper) ?? READINESS_BANDS[READINESS_BANDS.length - 1];
}

/** The score's inputs, each as a bar. `percent` is Garmin's own per-factor
 * contribution: how much that input is helping today, by its reckoning. */
export function ReadinessFactorList({ factors }: { factors: ReadinessFactor[] }) {
  if (factors.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {factors.map((factor) => (
        <motion.div
          key={factor.key}
          whileHover={{ y: -2, scale: 1.01 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "12px 15px", border: "var(--border-airbnb)", boxShadow: "var(--shadow-airbnb-subtle)" }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{factor.label}</span>
            <span className="font-mono" style={{ fontSize: 12.5, color: "var(--inchiostro-50)", flex: "none" }}>
              {factor.verdict ?? (factor.percent != null ? `${factor.percent}%` : "—")}
            </span>
          </div>
          {factor.percent != null && (
            <div style={{ height: 5, borderRadius: 100, background: "var(--sabbia-chip)", marginTop: 9, overflow: "hidden" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.max(0, Math.min(100, factor.percent))}%`,
                  background: "var(--verde-tratto-scuro)",
                  borderRadius: 100,
                }}
              />
            </div>
          )}
        </motion.div>
      ))}
    </div>
  );
}

/** The one-line "what is this number" that belongs next to the score wherever it is
 * shown, with a way through to the full explanation. */
export function ReadinessMeaning({ score, href }: { score: number; href?: string }) {
  const band = readinessBand(score);
  const text = `${score} su 100 · prontezza ${band.label}`;
  if (!href) {
    return (
      <p className="font-mono" style={{ fontSize: 12.5, margin: 0, opacity: 0.75 }}>
        {text}
      </p>
    );
  }
  return (
    <Link data-track="body-cards.href" href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <span className="font-mono" style={{ fontSize: 12.5, opacity: 0.75, borderBottom: "1px dotted currentColor" }}>
        {text} · cos&apos;è
      </span>
    </Link>
  );
}
