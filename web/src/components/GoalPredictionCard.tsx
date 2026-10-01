"use client";

import { SlideUp } from "@/components/motion/primitives";
import type { RacePredictionData } from "@/lib/types";

interface GoalPredictionCardProps {
  prediction: RacePredictionData;
  animate?: boolean;
  delayMs?: number;
}

const SEVERITY_STYLE: Record<string, { background: string; color: string; label: string }> = {
  ok: { background: "var(--verde-chiaro)", color: "var(--verde-testo)", label: "ok" },
  attenzione: { background: "var(--rosa-avviso)", color: "var(--rosso-testo)", label: "da verificare" },
  sconosciuto: { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", label: "nota" },
};

export function GoalPredictionCard({ prediction, animate = true, delayMs = 0 }: GoalPredictionCardProps) {
  const isUnknown = prediction.confidence === "non_valutabile";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. Main Projection Card */}
      <SlideUp
        active={animate}
        delayMs={delayMs}
        style={{
          background: "var(--crema-card)",
          borderRadius: "var(--radius-card-lg)",
          padding: 20,
          border: "1px solid rgba(34, 34, 34, 0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 700,
              margin: 0,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: "var(--inchiostro-50)",
            }}
          >
            Previsione Dinamica & Confidenza
          </p>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background: prediction.confidence_color.startsWith("var") ? prediction.confidence_color : prediction.confidence_color,
              color: prediction.confidence_color === "var(--azzurro)" ? "var(--inchiostro)" : "#ffffff",
            }}
          >
            {prediction.confidence_label}
          </span>
        </div>

        {/* Prediction figures */}
        {!isUnknown && prediction.predicted_time_formatted ? (
          <div style={{ margin: "14px 0" }}>
            <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "8px 16px" }}>
              <p className="font-mono" style={{ fontSize: 32, fontWeight: 800, margin: 0, color: "var(--inchiostro)" }}>
                {prediction.predicted_time_formatted}
              </p>
              {prediction.predicted_pace_formatted && (
                <span className="font-mono" style={{ fontSize: 16, fontWeight: 600, color: "var(--inchiostro-70)" }}>
                  passo medio {prediction.predicted_pace_formatted}
                </span>
              )}
            </div>

            {/* Target comparison */}
            {prediction.target_time_formatted && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  marginTop: 10,
                  padding: "8px 12px",
                  borderRadius: "var(--radius-card)",
                  background: prediction.gap_seconds != null && prediction.gap_seconds >= 0 ? "rgba(16, 185, 129, 0.08)" : "rgba(249, 115, 22, 0.08)",
                }}
              >
                <span style={{ fontSize: 12, color: "var(--inchiostro-70)" }}>
                  Obiettivo dichiarato: <strong className="font-mono">{prediction.target_time_formatted}</strong>
                </span>
                {prediction.gap_formatted && (
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: prediction.gap_seconds != null && prediction.gap_seconds >= 0 ? "#047857" : "#c2410c",
                    }}
                  >
                    {prediction.gap_seconds != null && prediction.gap_seconds >= 0
                      ? `${prediction.gap_formatted} di margine`
                      : `${prediction.gap_formatted} rispetto al target`}
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div style={{ margin: "14px 0" }}>
            <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: "var(--inchiostro)" }}>
              {prediction.headline}
            </p>
            <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.45 }}>
              {prediction.verdict}
            </p>
          </div>
        )}

        {/* Verdict & Advice */}
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-80)", margin: "8px 0 0", lineHeight: 1.45 }}>
          {prediction.advice}
        </p>

        {/* Reference effort mention */}
        {prediction.reference_effort && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(34, 34, 34, 0.06)", fontSize: 11, color: "var(--inchiostro-50)" }}>
            Proiezione Riegel calcolata da:{" "}
            <strong>
              {prediction.reference_effort.title} ({prediction.reference_effort.distance_km} km a {prediction.reference_effort.pace_min_km.toFixed(2)}/km)
            </strong>{" "}
            il {prediction.reference_effort.date}
          </div>
        )}
      </SlideUp>

      {/* 2. Factors Breakdown */}
      {prediction.factors.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {prediction.factors.map((factor, i) => {
            const style = SEVERITY_STYLE[factor.severity] ?? SEVERITY_STYLE.sconosciuto;
            return (
              <SlideUp
                key={factor.key}
                active={animate}
                delayMs={delayMs + 60 + i * 40}
                style={{
                  background: "var(--crema-card)",
                  borderRadius: "var(--radius-row)",
                  padding: "12px 16px",
                  border: "1px solid rgba(34, 34, 34, 0.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <p style={{ fontWeight: 600, fontSize: 13.5, margin: 0 }}>{factor.label}</p>
                  <span
                    style={{
                      background: style.background,
                      color: style.color,
                      borderRadius: "var(--radius-pill)",
                      padding: "2px 8px",
                      fontSize: 10,
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {style.label}
                  </span>
                </div>
                <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "4px 0 0", lineHeight: 1.4 }}>
                  {factor.detail}
                </p>
              </SlideUp>
            );
          })}
        </div>
      )}
    </div>
  );
}
