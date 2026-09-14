"use client";

import { SlideUp } from "@/components/motion/primitives";
import { formatPaceOrDash } from "@/lib/format";
import type {
  ActivityForm,
  FormMetric,
  FormVerdict,
  MetricTrend,
  PacingRead,
  TrendDirection,
  TrendPoint,
} from "@/lib/types";

// The presentational half of /coach: one finished activity, read for technique.
//
// Every row here shows the measurement *and* the band it was judged against, for the
// same reason the readiness screen shows its signals with their figures: a verdict the
// user cannot check is a verdict they have to take on faith, and form metrics are
// exactly the kind of number people take on faith and then train badly on.

const VERDICT_STYLE: Record<FormVerdict, { background: string; color: string }> = {
  buono: { background: "var(--verde)", color: "var(--verde-testo)" },
  "nella norma": { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)" },
  "da lavorarci": { background: "var(--giallo)", color: "var(--giallo-testo)" },
  "da leggere": { background: "var(--sabbia-chip)", color: "var(--inchiostro-50)" },
};

function VerdictChip({ verdict }: { verdict: FormVerdict }) {
  const style = VERDICT_STYLE[verdict] ?? VERDICT_STYLE["da leggere"];
  return (
    <span
      style={{
        background: style.background,
        color: style.color,
        borderRadius: "var(--radius-pill)",
        padding: "3px 10px",
        fontSize: 10.5,
        fontWeight: 700,
        flex: "none",
        whiteSpace: "nowrap",
      }}
    >
      {verdict}
    </span>
  );
}

export function MetricRow({ metric, animate, delayMs }: { metric: FormMetric; animate: boolean; delayMs: number }) {
  return (
    <SlideUp active={animate} delayMs={delayMs} row style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p style={{ fontWeight: 600, fontSize: 14.5, margin: 0 }}>{metric.label}</p>
        <VerdictChip verdict={metric.verdict} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 7 }}>
        <span className="font-mono" style={{ fontSize: 21, fontWeight: 500, letterSpacing: "-.02em" }}>
          {metric.display}
        </span>
        <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-35)" }}>
          rif. {metric.reference}
        </span>
      </div>

      <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.35 }}>
        {metric.meaning}
      </p>

      {metric.cue && (
        <p style={{ background: "var(--sabbia)", borderRadius: "var(--radius-chip)", padding: "10px 12px", fontSize: 13, margin: "10px 0 0", lineHeight: 1.4 }}>
          {metric.cue}
        </p>
      )}
    </SlideUp>
  );
}

export function PacingBlock({ pacing, animate, delayMs }: { pacing: PacingRead; animate: boolean; delayMs: number }) {
  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
          come l&apos;hai distribuita
        </p>
        <VerdictChip verdict={pacing.verdict} />
      </div>

      <p style={{ font: "600 17px/1.25 var(--font-outfit)", margin: "8px 0 0" }}>Split {pacing.kind}</p>

      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <Half label="prima metà" pace={pacing.first_half_pace_sec_per_km} />
        <Half label="seconda metà" pace={pacing.second_half_pace_sec_per_km} />
      </div>

      <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "12px 0 0", lineHeight: 1.35 }}>
        {pacing.detail}
      </p>
    </SlideUp>
  );
}

function Half({ label, pace }: { label: string; pace: number | null }) {
  return (
    <div style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-chip)", padding: "12px 14px" }}>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: 0 }}>{label}</p>
      <p className="font-mono" style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-.02em", margin: "5px 0 0" }}>
        {formatPaceOrDash(pace)}
      </p>
    </div>
  );
}

/** The one thing to take away. Always one -- a screen that hands someone five things to
 * fix hands them nothing, which is why `technique.py` picks the focus rather than
 * letting the UI list every cue it received. */
export function FocusBlock({ form, animate, narrativeText }: { form: ActivityForm; animate: boolean; narrativeText?: string }) {
  return (
    <SlideUp
      active={animate}
      delayMs={100}
      style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 22, marginTop: 18 }}
    >
      <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)", margin: 0 }}>
        il tuo allenatore
      </p>
      <p style={{ font: "600 24px/1.15 var(--font-outfit)", letterSpacing: "-.02em", margin: "10px 0 0" }}>{form.headline}</p>
      <p className="font-serif-italic" style={{ fontSize: 16, lineHeight: 1.35, margin: "12px 0 0" }}>
        {narrativeText ?? form.focus ?? "Le misure qui sotto sono tutte dentro le loro fasce di riferimento."}
      </p>
      {narrativeText && form.focus && (
        <p style={{ background: "rgba(246,238,218,.12)", borderRadius: "var(--radius-chip)", padding: "12px 14px", fontSize: 13.5, margin: "14px 0 0", lineHeight: 1.4 }}>
          {form.focus}
        </p>
      )}
    </SlideUp>
  );
}

// ---- the same metric, across sessions --------------------------------------------------
//
// A stat tile per metric: label, current value, signed delta against a named period, and
// a sparkline. Not a chart per metric -- one current value plus its history is the
// textbook case for a tile, and eight little line charts stacked down a phone would be
// eight things to read instead of one.
//
// Single series throughout, so there is no legend to draw and no categorical palette to
// pick: the history is the de-emphasis grey, the latest point carries the accent.

const DIRECTION_COLOR: Record<TrendDirection, string> = {
  "in miglioramento": "var(--verde-testo)",
  "in peggioramento": "var(--rosso-testo)",
  stabile: "var(--inchiostro-50)",
  // The metric moved, and nothing here knows whether that is good -- so it gets ink,
  // not a colour that implies a verdict.
  cambiato: "var(--inchiostro-70)",
};

const SPARK_WIDTH = 76;
const SPARK_HEIGHT = 26;

/** The history as a polyline, with the latest reading marked.
 *
 * Deliberately unlabelled: it is a shape, not a chart, and the numbers it summarises
 * are the two printed next to it. Its own points carry `<title>` so a pointer can still
 * read any of them. */
function Sparkline({ points, accent }: { points: TrendPoint[]; accent: string }) {
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  // Inset by the marker radius so the first and last points are not half-clipped.
  const pad = 3;
  const x = (i: number) => pad + (i / Math.max(points.length - 1, 1)) * (SPARK_WIDTH - pad * 2);
  const y = (value: number) => pad + (1 - (value - min) / span) * (SPARK_HEIGHT - pad * 2);

  return (
    <svg
      width={SPARK_WIDTH}
      height={SPARK_HEIGHT}
      viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`}
      role="img"
      aria-label={`Andamento su ${points.length} sedute`}
      style={{ flex: "none", overflow: "visible" }}
    >
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")}
        fill="none"
        stroke="var(--neutro-barra)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, i) => (
        <circle key={point.date} cx={x(i)} cy={y(point.value)} r={i === points.length - 1 ? 3.5 : 1.5} fill={i === points.length - 1 ? accent : "var(--neutro-barra)"}>
          <title>{`${point.date}: ${point.value}`}</title>
        </circle>
      ))}
    </svg>
  );
}

function TrendTile({ trend, animate, delayMs }: { trend: MetricTrend; animate: boolean; delayMs: number }) {
  const color = DIRECTION_COLOR[trend.direction] ?? DIRECTION_COLOR.stabile;
  const signed = `${trend.delta > 0 ? "+" : ""}${trend.delta}`;

  return (
    <SlideUp active={animate} delayMs={delayMs} row style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: 0 }}>{trend.label}</p>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
            <span className="font-mono" style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>
              {trend.current}
            </span>
            <span style={{ fontSize: 11.5, color: "var(--inchiostro-50)" }}>{trend.unit}</span>
            {trend.direction !== "stabile" && (
              <span className="font-mono" style={{ fontSize: 12.5, fontWeight: 700, color }}>
                {signed} {trend.unit}
              </span>
            )}
          </div>
        </div>
        <Sparkline points={trend.points} accent={color} />
      </div>

      <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "8px 0 0", lineHeight: 1.4 }}>
        <span style={{ color, fontWeight: 600 }}>{trend.direction}</span> · {trend.detail}
      </p>
    </SlideUp>
  );
}

export function TrendSection({ trends, sessionsRead, animate }: { trends: MetricTrend[]; sessionsRead: number; animate: boolean }) {
  if (trends.length === 0) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
          Come stai cambiando
        </span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          {sessionsRead} sedute
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {trends.map((trend, i) => (
          <TrendTile key={trend.key} trend={trend} animate={animate} delayMs={120 + i * 50} />
        ))}
      </div>

      <p style={{ fontSize: 11.5, color: "var(--inchiostro-35)", margin: "12px 0 0", lineHeight: 1.45 }}>
        Ogni riga confronta l&apos;ultima seduta con la media di quelle prima. Sotto il 3% di
        differenza non è un cambiamento: è il rumore di terreno, scarpe e come stava
        l&apos;orologio al polso.
      </p>
    </div>
  );
}
