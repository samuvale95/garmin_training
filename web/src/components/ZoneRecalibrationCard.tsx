"use client";

import { useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import type { ZoneRecalibrationData } from "@/lib/types";

interface ZoneRecalibrationCardProps {
  data: ZoneRecalibrationData;
  animate?: boolean;
  delayMs?: number;
}

const ZONE_COLORS: Record<number, string> = {
  1: "#0ea5e9", // Z1 Sky blue
  2: "#10b981", // Z2 Emerald green
  3: "#f59e0b", // Z3 Amber
  4: "#f97316", // Z4 Orange
  5: "#ef4444", // Z5 Red
};

export function ZoneRecalibrationCard({ data, animate = true, delayMs = 0 }: ZoneRecalibrationCardProps) {
  const [showTable, setShowTable] = useState(false);
  const isUnknown = data.status === "dati_insufficienti";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* 1. Main Threshold Card */}
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
            Soglia & Ricalibrazione Zone
          </p>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background: data.status_color.startsWith("var") ? data.status_color : data.status_color,
              color: "#ffffff",
            }}
          >
            {data.status_label}
          </span>
        </div>

        {/* Big numbers row */}
        {!isUnknown && data.estimated_lthr ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, margin: "14px 0" }}>
            {/* LTHR Card */}
            <div style={{ background: "rgba(249, 115, 22, 0.08)", padding: 14, borderRadius: "var(--radius-card)" }}>
              <span style={{ fontSize: 11, color: "#c2410c", fontWeight: 700, textTransform: "uppercase" }}>
                Soglia FC (LTHR)
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "4px 0 2px" }}>
                <p className="font-mono" style={{ fontSize: 28, fontWeight: 800, margin: 0, color: "#7c2d12" }}>
                  {data.estimated_lthr}
                </p>
                <span style={{ fontSize: 13, color: "#7c2d12", fontWeight: 600 }}>bpm</span>
              </div>
              <span style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
                {data.diff_lthr_bpm != null
                  ? `${data.diff_lthr_bpm >= 0 ? "+" : ""}${data.diff_lthr_bpm} bpm rispetto a Garmin`
                  : "stima su corse recenti"}
              </span>
            </div>

            {/* Threshold Pace Card */}
            <div style={{ background: "rgba(59, 130, 246, 0.08)", padding: 14, borderRadius: "var(--radius-card)" }}>
              <span style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 700, textTransform: "uppercase" }}>
                Passo Soglia
              </span>
              <p className="font-mono" style={{ fontSize: 28, fontWeight: 800, margin: "4px 0 2px", color: "#1e3a8a" }}>
                {data.estimated_threshold_pace_formatted}
              </p>
              <span style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
                ritmo anaerobico sostenibile
              </span>
            </div>
          </div>
        ) : (
          <div style={{ margin: "14px 0" }}>
            <p style={{ fontSize: 16, fontWeight: 700, margin: "0 0 6px", color: "var(--inchiostro)" }}>
              {data.headline}
            </p>
            <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.45 }}>
              {data.summary}
            </p>
          </div>
        )}

        {/* Advice line */}
        <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-80)", margin: "8px 0 0", lineHeight: 1.45 }}>
          {data.advice}
        </p>

        {/* Supporting activities */}
        {data.supporting_workouts.length > 0 && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid rgba(34, 34, 34, 0.06)" }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--inchiostro-50)", margin: "0 0 6px" }}>
              Sedute che hanno evidenziato la soglia:
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {data.supporting_workouts.map((w) => (
                <div key={w.activity_id} style={{ fontSize: 12, color: "var(--inchiostro-70)" }}>
                  • <strong>{w.title}</strong> ({w.distance_km} km a {w.avg_pace_formatted}, {w.avg_hr} bpm medi) il {w.date}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Toggle 5-Zone breakdown table */}
        {data.zones.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              onClick={() => setShowTable(!showTable)}
              style={{
                background: "var(--inchiostro)",
                color: "#ffffff",
                border: "none",
                borderRadius: "var(--radius-pill)",
                padding: "8px 16px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {showTable ? "Nascondi tabella 5 zone" : "Mostra tabella 5 zone (Passo & FC)"}
            </button>
          </div>
        )}
      </SlideUp>

      {/* 2. 5-Zones Detailed Table */}
      {showTable && data.zones.length > 0 && (
        <SlideUp
          active={animate}
          delayMs={delayMs + 60}
          style={{
            background: "var(--crema-card)",
            borderRadius: "var(--radius-card-lg)",
            padding: 16,
            border: "1px solid rgba(34, 34, 34, 0.06)",
          }}
        >
          <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", color: "var(--inchiostro-50)", margin: "0 0 10px" }}>
            Le tue 5 zone ricalibrate
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {data.zones.map((z) => {
              const color = ZONE_COLORS[z.zone_number] ?? "#888";
              return (
                <div
                  key={z.zone_number}
                  style={{
                    background: "rgba(34, 34, 34, 0.03)",
                    borderRadius: "var(--radius-card)",
                    padding: "10px 14px",
                    borderLeft: `4px solid ${color}`,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: "var(--inchiostro)" }}>
                      {z.name}
                    </span>
                    <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
                      <span className="font-mono" style={{ fontWeight: 600, color: "var(--inchiostro)" }}>
                        {z.hr_range_formatted}
                      </span>
                      <span className="font-mono" style={{ fontWeight: 600, color: "var(--inchiostro-70)" }}>
                        {z.pace_range_formatted}
                      </span>
                    </div>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>
                    {z.description}
                  </p>
                </div>
              );
            })}
          </div>
        </SlideUp>
      )}
    </div>
  );
}
