"use client";

import Link from "next/link";
import { SlideUp, StatusDot } from "@/components/motion/primitives";
import type { DayVerdict } from "@/lib/types";

/** The palette of the three states. Green/sand/coral rather than green/amber/red: this
 * screen reports a training decision, not a medical alarm, and a red card for a short
 * night would say something the data does not. */
const STATE_STYLE: Record<string, { background: string; color: string; dot: "active" | "queued" | "in_progress" }> = {
  pronto: { background: "var(--verde)", color: "var(--verde-testo)", dot: "active" },
  cauto: { background: "var(--giallo)", color: "var(--giallo-testo)", dot: "queued" },
  scarico: { background: "var(--corallo)", color: "var(--corallo-testo)", dot: "in_progress" },
  sconosciuto: { background: "var(--sabbia)", color: "var(--inchiostro-70)", dot: "queued" },
};

const ACTION_LABEL: Record<string, string> = {
  conferma: "fai la seduta",
  alleggerisci: "alleggeriscila",
  sposta: "spostala",
  riposa: "riposa",
};

/** "Stato del giorno" on Oggi: the verdict in one line, tappable for the numbers behind
 * it. Renders nothing while there is no answer yet -- an empty state here would be a
 * card saying "non lo so" every morning before the first fetch lands. */
export function DayStateCard({ verdict, narrative, animate, delayMs = 0 }: { verdict: DayVerdict | undefined; narrative?: string; animate: boolean; delayMs?: number }) {
  if (!verdict) return null;
  const style = STATE_STYLE[verdict.state] ?? STATE_STYLE.sconosciuto;
  const line = narrative ?? verdict.headline;

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 14 }}>
      <Link
        href="/body/stato"
        className="press-soft"
        style={{
          display: "block",
          background: style.background,
          color: style.color,
          borderRadius: "var(--radius-card)",
          padding: "15px 18px",
          textDecoration: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <StatusDot kind={style.dot} size={8} />
            <span className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.75 }}>
              stato del giorno
            </span>
          </span>
          {verdict.action && (
            <span style={{ background: "rgba(28,26,22,.1)", borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
              {ACTION_LABEL[verdict.action]}
            </span>
          )}
        </div>

        <p style={{ font: "600 17px/1.25 var(--font-outfit)", letterSpacing: "-.01em", margin: "8px 0 0" }}>{verdict.headline}</p>
        {line !== verdict.headline && (
          <p className="font-serif-italic" style={{ fontSize: 14.5, lineHeight: 1.35, margin: "6px 0 0", opacity: 0.9 }}>
            {line}
          </p>
        )}
        {verdict.signals.length > 0 && (
          <p className="font-mono" style={{ fontSize: 11, margin: "8px 0 0", opacity: 0.75 }}>
            {verdict.signals.map((s) => s.label.toLowerCase()).join(" · ")}
          </p>
        )}
      </Link>
    </SlideUp>
  );
}
