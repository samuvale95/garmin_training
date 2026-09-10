"use client";

import { SlideUp } from "@/components/motion/primitives";
import type { GoalFit } from "@/lib/types";

/** "Il piano che hai già" — the sessions written before the race was named, read
 * against it.
 *
 * This is the answer to the question a runner asks the second they set a goal: *do the
 * workouts I already have go there?* Nothing is re-imported and nothing is rewritten;
 * the plan is simply read again with a date and a distance to compare it to.
 */

const ALIGNMENT_STYLE: Record<string, { background: string; color: string; overline: string }> = {
  "in linea": { background: "var(--verde)", color: "var(--verde-testo)", overline: "il piano ci porta" },
  "da guardare": { background: "var(--giallo)", color: "var(--giallo-testo)", overline: "ci sta, con qualche se" },
  "non arriva": { background: "var(--corallo)", color: "var(--corallo-testo)", overline: "il piano si ferma prima" },
  "non valutabile": { background: "var(--sabbia)", color: "var(--inchiostro-70)", overline: "quello che riesco a vedere" },
};

const SEVERITY_STYLE: Record<string, { background: string; color: string; label: string }> = {
  ok: { background: "var(--verde-chiaro)", color: "var(--verde-testo)", label: "ok" },
  attenzione: { background: "var(--rosa-avviso)", color: "var(--rosso-testo)", label: "da guardare" },
  sconosciuto: { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", label: "non lo so" },
};

function formatKm(km: number): string {
  return `${Math.round(km)} km`;
}

export function GoalFitBlock({ fit, narrative, animate, delayMs = 0 }: { fit: GoalFit; narrative?: string; animate: boolean; delayMs?: number }) {
  const style = ALIGNMENT_STYLE[fit.alignment] ?? ALIGNMENT_STYLE["non valutabile"];

  return (
    <>
      <SlideUp
        active={animate}
        delayMs={delayMs}
        style={{ background: style.background, color: style.color, borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 12 }}
      >
        <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.75, margin: 0 }}>
          {style.overline}
        </p>
        <p style={{ font: "600 19px/1.25 var(--font-outfit)", letterSpacing: "-.01em", margin: "8px 0 0" }}>{fit.headline}</p>
        <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.35, margin: "8px 0 0", opacity: 0.92 }}>
          {narrative ?? "Ho riletto le sedute che hai già, da oggi alla gara."}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", marginTop: 14 }}>
          <span className="font-mono" style={{ fontSize: 12, opacity: 0.8 }}>
            {fit.sessions_ahead} sedute
          </span>
          <span className="font-mono" style={{ fontSize: 12, opacity: 0.8 }}>
            {fit.weeks_covered} settimane
          </span>
          {fit.longest_run_km != null && (
            <span className="font-mono" style={{ fontSize: 12, opacity: 0.8 }}>
              lungo max {formatKm(fit.longest_run_km)}
            </span>
          )}
          {fit.peak_week_km != null && (
            <span className="font-mono" style={{ fontSize: 12, opacity: 0.8 }}>
              picco {formatKm(fit.peak_week_km)}
            </span>
          )}
        </div>
      </SlideUp>

      {fit.observations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
          {fit.observations.map((observation, i) => {
            const severity = SEVERITY_STYLE[observation.severity] ?? SEVERITY_STYLE.sconosciuto;
            return (
              <SlideUp
                key={observation.key}
                active={animate}
                delayMs={delayMs + 80 + i * 50}
                row
                style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "13px 16px" }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <p style={{ fontWeight: 600, fontSize: 14.5, margin: 0 }}>{observation.label}</p>
                  <span style={{ background: severity.background, color: severity.color, borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 10.5, fontWeight: 700, flex: "none" }}>
                    {severity.label}
                  </span>
                </div>
                <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "5px 0 0", lineHeight: 1.4 }}>
                  {observation.detail}
                </p>
              </SlideUp>
            );
          })}
        </div>
      )}
    </>
  );
}
