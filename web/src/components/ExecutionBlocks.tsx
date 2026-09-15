"use client";

import { SlideUp } from "@/components/motion/primitives";
import { formatMinutes, formatShortDate } from "@/lib/format";
import type { BlockDistribution, Finding, SessionExecution } from "@/lib/types";

// The presentational half of /coach/esecuzione.
//
// One design rule runs through all of it: **a claim never appears without a label saying
// what kind of claim it is.** "Il 41% dei tuoi minuti facili è sopra soglia" is a
// measurement. "Spostarlo sotto il 10% migliora la base aerobica" is a population
// finding. "Nei tuoi blocchi più polarizzati il disaccoppiamento è sceso" is a
// correlation in one person's uncontrolled data. Rendering all three identically is how
// an app ends up sounding certain about things nobody is certain about.

const ZONE_COLORS = {
  easy: "var(--verde-tratto-scuro)",
  grey: "var(--giallo)",
  hard: "var(--corallo)",
} as const;

const ZONE_LABELS = {
  easy: "facile",
  grey: "intermedia",
  hard: "dura",
} as const;

/** Where the published reference sits, drawn on the bar itself. */
const POLARIZED_EASY_SHARE = 0.8;

function Swatch({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--inchiostro-70)" }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color, flex: "none" }} />
      {children}
    </span>
  );
}

/** The block's time split across the three zones, as one part-to-whole bar with the
 * reference marked on it.
 *
 * Three series, so the legend is always present and each segment is also direct-labelled
 * where it is wide enough to hold a number -- identity is never carried by colour alone.
 * The dashed marker is the 80% reference: without it the bar shows a distribution but
 * answers nothing. */
export function DistributionBar({ block, animate }: { block: BlockDistribution; animate: boolean }) {
  const segments = [
    { key: "easy" as const, share: block.easy_share, seconds: block.zones.easy_seconds },
    { key: "grey" as const, share: block.grey_share, seconds: block.zones.grey_seconds },
    { key: "hard" as const, share: block.hard_share, seconds: block.zones.hard_seconds },
  ];

  return (
    <SlideUp active={animate} delayMs={140} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
          distribuzione del tempo
        </p>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)" }}>
          {formatMinutes(Math.round((block.zones.easy_seconds + block.zones.grey_seconds + block.zones.hard_seconds) / 60))}
        </span>
      </div>

      <div style={{ position: "relative", marginTop: 14 }}>
        {/* 2px of surface between segments, so adjacent fills read as separate marks
            rather than one gradient. */}
        <div style={{ display: "flex", gap: 2, height: 22, borderRadius: 6, overflow: "hidden" }}>
          {segments.map((segment) => (
            <div
              key={segment.key}
              title={`${ZONE_LABELS[segment.key]}: ${formatMinutes(Math.round(segment.seconds / 60))}`}
              style={{
                width: `${Math.max(segment.share * 100, segment.share > 0 ? 2 : 0)}%`,
                background: ZONE_COLORS[segment.key],
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {segment.share >= 0.12 && (
                <span className="font-mono" style={{ fontSize: 11, fontWeight: 700, color: "var(--inchiostro)" }}>
                  {Math.round(segment.share * 100)}%
                </span>
              )}
            </div>
          ))}
        </div>

        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -4,
            bottom: -4,
            left: `${POLARIZED_EASY_SHARE * 100}%`,
            borderLeft: "2px dashed var(--inchiostro)",
          }}
        />
      </div>

      <p className="font-mono" style={{ fontSize: 10.5, color: "var(--inchiostro-35)", margin: "8px 0 0", textAlign: "right" }}>
        ┆ riferimento 80%
      </p>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
        {segments.map((segment) => (
          <Swatch key={segment.key} color={ZONE_COLORS[segment.key]}>
            {ZONE_LABELS[segment.key]} · {formatMinutes(Math.round(segment.seconds / 60))}
          </Swatch>
        ))}
      </div>
    </SlideUp>
  );
}

const EVIDENCE_STYLE: Record<Finding["evidence"], { background: string; color: string; title: string }> = {
  misurato: { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", title: "un numero preso dai tuoi dati" },
  ricerca: { background: "var(--azzurro)", color: "var(--azzurro-testo)", title: "un risultato della ricerca su popolazione" },
  "tuoi dati": { background: "var(--lilla)", color: "var(--inchiostro)", title: "una correlazione nei tuoi dati, non un esperimento" },
};

export function FindingCard({ finding, animate, delayMs }: { finding: Finding; animate: boolean; delayMs: number }) {
  const evidence = EVIDENCE_STYLE[finding.evidence] ?? EVIDENCE_STYLE.misurato;
  const alert = finding.severity === "attenzione";

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: "var(--crema-card)",
        borderRadius: "var(--radius-card)",
        padding: 18,
        borderLeft: alert ? "3px solid var(--corallo)" : "3px solid transparent",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p style={{ font: "600 16px/1.25 var(--font-outfit)", margin: 0 }}>{finding.headline}</p>
        <span
          title={evidence.title}
          style={{
            background: evidence.background,
            color: evidence.color,
            borderRadius: "var(--radius-pill)",
            padding: "3px 10px",
            fontSize: 10,
            fontWeight: 700,
            flex: "none",
            whiteSpace: "nowrap",
          }}
        >
          {finding.evidence}
        </span>
      </div>

      <p className="font-mono" style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "9px 0 0", lineHeight: 1.45 }}>
        {finding.measured}
      </p>

      {finding.standard && (
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "10px 0 0", lineHeight: 1.35 }}>
          {finding.standard}
        </p>
      )}

      {finding.action && (
        <p style={{ background: "var(--sabbia)", borderRadius: "var(--radius-chip)", padding: "11px 13px", fontSize: 13, margin: "12px 0 0", lineHeight: 1.4 }}>
          {finding.action}
        </p>
      )}
    </SlideUp>
  );
}

export function SessionExecutionRow({
  execution,
  animate,
  delayMs,
}: {
  execution: SessionExecution;
  animate: boolean;
  delayMs: number;
}) {
  const total =
    execution.zones.easy_seconds + execution.zones.grey_seconds + execution.zones.hard_seconds || 1;

  return (
    <SlideUp active={animate} delayMs={delayMs} row style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "13px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p style={{ fontWeight: 600, fontSize: 14.5, margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {execution.title}
        </p>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", flex: "none" }}>
          {formatShortDate(execution.date)}
        </span>
      </div>

      <div style={{ display: "flex", gap: 2, height: 6, borderRadius: 3, overflow: "hidden", marginTop: 9 }}>
        <div style={{ width: `${(execution.zones.easy_seconds / total) * 100}%`, background: ZONE_COLORS.easy }} />
        <div style={{ width: `${(execution.zones.grey_seconds / total) * 100}%`, background: ZONE_COLORS.grey }} />
        <div style={{ width: `${(execution.zones.hard_seconds / total) * 100}%`, background: ZONE_COLORS.hard }} />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 9 }}>
        {execution.honoured === false && (
          <span style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-pill)", padding: "2px 9px", fontSize: 10, fontWeight: 700, flex: "none" }}>
            troppo dura
          </span>
        )}
        {execution.honoured === true && (
          <span style={{ background: "var(--verde)", color: "var(--verde-testo)", borderRadius: "var(--radius-pill)", padding: "2px 9px", fontSize: 10, fontWeight: 700, flex: "none" }}>
            ok
          </span>
        )}
        <span style={{ fontSize: 12, color: "var(--inchiostro-50)", lineHeight: 1.4 }}>{execution.detail}</span>
      </div>
    </SlideUp>
  );
}
