"use client";

import { SlideUp } from "@/components/motion/primitives";
import { formatPaceOrDash } from "@/lib/format";
import type { ActivityForm, FormMetric, FormVerdict, PacingRead } from "@/lib/types";

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
