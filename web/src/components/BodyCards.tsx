"use client";

import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { formatMinutes, weekdayInitial } from "@/lib/format";
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

export function SleepCard({ sleep, animate, delayMs }: { sleep: SleepPhases; animate: boolean; delayMs: number }) {
  const total = sleep.total_minutes ?? 0;
  // The bar is drawn over the phases that were actually measured, not over the night's
  // total: the two differ by a few minutes on most nights, and a bar that does not
  // fill is a bug the user has to explain to themselves.
  const measured = SLEEP_PHASES.reduce((sum, phase) => sum + (phaseMinutes(sleep, phase.key) ?? 0), 0) || 1;

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <p className="font-mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: 0 }}>
          Sonno
        </p>
        {sleep.score != null && (
          <span
            style={{
              background: "rgba(23,42,66,.12)",
              borderRadius: "var(--radius-pill)",
              padding: "3px 9px",
              fontSize: 11,
              fontWeight: 700,
            }}
          >
            qualità {sleep.score}/100{sleep.score_label ? ` · ${sleep.score_label}` : ""}
          </span>
        )}
      </div>

      <p className="font-mono" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-.02em", margin: "8px 0 0" }}>
        {formatMinutes(total)}
      </p>
      <p style={{ fontSize: 11.5, opacity: 0.75, margin: "2px 0 0" }}>dormite in tutto</p>

      <div style={{ display: "flex", height: 7, borderRadius: 100, overflow: "hidden", marginTop: 12 }}>
        {SLEEP_PHASES.map((phase) => {
          const minutes = phaseMinutes(sleep, phase.key) ?? 0;
          return <div key={phase.key} style={{ width: `${(minutes / measured) * 100}%`, background: phase.color }} />;
        })}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12 }}>
        {SLEEP_PHASES.map((phase) => {
          const minutes = phaseMinutes(sleep, phase.key);
          if (minutes == null) return null;
          return (
            <div key={phase.key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: phase.color, flex: "none" }} />
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{phase.label}</span>
              <span className="font-mono" style={{ fontSize: 13 }}>{formatMinutes(minutes)}</span>
              <span className="font-mono" style={{ fontSize: 11, opacity: 0.6, width: 38, textAlign: "right" }}>
                {Math.round((minutes / measured) * 100)}%
              </span>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 11, opacity: 0.7, margin: "10px 0 0", lineHeight: 1.4 }}>
        Riferimento: profondo {SLEEP_PHASES[0].share}, REM {SLEEP_PHASES[1].share}.
      </p>
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
          <div key={phase.key} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "13px 16px" }}>
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
            <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)", margin: "5px 0 0" }}>
              di solito {phase.share}
            </p>
          </div>
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
}: {
  points: HrvPoint[];
  lastNight: number | null;
  animate: boolean;
  delayMs: number;
}) {
  const values = points.map((p) => p.value_ms).filter((v): v is number => v != null);
  const max = Math.max(...values, 1);
  const earlier = values.slice(0, -1);
  const baseline = earlier.length > 0 ? earlier.reduce((sum, v) => sum + v, 0) / earlier.length : null;
  const delta = baseline != null && lastNight != null ? Math.round(((lastNight - baseline) / baseline) * 100) : null;

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16 }}
    >
      <p className="font-mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: 0, color: "var(--inchiostro-50)" }}>
        Variabilità cardiaca
      </p>

      <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginTop: 8 }}>
        <span className="font-mono" style={{ fontSize: 26, fontWeight: 500, letterSpacing: "-.02em" }}>
          {lastNight ?? "—"}
        </span>
        <span style={{ fontSize: 12.5, color: "var(--inchiostro-50)" }}>ms stanotte</span>
      </div>

      {baseline != null && (
        <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>
          media delle altre {earlier.length} notti: {Math.round(baseline)} ms
          {delta != null && ` · ${delta > 0 ? "+" : ""}${delta}%`}
        </p>
      )}

      <div style={{ position: "relative", height: HRV_CHART_HEIGHT, marginTop: 14 }}>
        {baseline != null && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: `${(baseline / max) * HRV_CHART_HEIGHT}px`,
              borderTop: "1px dashed var(--inchiostro-35)",
            }}
          />
        )}
        <div style={{ position: "relative", display: "flex", alignItems: "flex-end", gap: 4, height: "100%" }}>
          {points.map((point, i) => {
            const isLast = i === points.length - 1;
            const value = point.value_ms ?? 0;
            return (
              <div
                key={point.date}
                className={isLast ? "anim-tip-grow" : undefined}
                title={`${point.value_ms ?? "—"} ms`}
                style={{
                  flex: 1,
                  height: `${Math.max(5, (value / max) * HRV_CHART_HEIGHT)}px`,
                  background: isLast ? "var(--verde-tratto-scuro)" : "var(--neutro-barra)",
                  borderRadius: 3,
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
              fontSize: 10,
              color: i === points.length - 1 ? "var(--inchiostro)" : "var(--inchiostro-35)",
              fontWeight: i === points.length - 1 ? 700 : 400,
            }}
          >
            {weekdayInitial(point.date)}
          </span>
        ))}
      </div>

      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "10px 0 0", lineHeight: 1.4 }}>
        Una barra per notte, l&apos;ultima è stanotte. Quanto varia la distanza fra un battito e
        l&apos;altro mentre dormi: sale quando sei recuperato, scende quando il corpo sta ancora
        lavorando. Conta solo rispetto alla tua media, mai a quella di altri.
      </p>
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
        <div key={factor.key} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "12px 15px" }}>
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
        </div>
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
      <p className="font-mono" style={{ fontSize: 11.5, margin: 0, opacity: 0.75 }}>
        {text}
      </p>
    );
  }
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }}>
      <span className="font-mono" style={{ fontSize: 11.5, opacity: 0.75, borderBottom: "1px dotted currentColor" }}>
        {text} · cos&apos;è
      </span>
    </Link>
  );
}
