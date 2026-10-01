"use client";

import { useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import type { PersonalCorrelationsData } from "@/lib/types";

interface PersonalCorrelationsCardProps {
  data: PersonalCorrelationsData;
  animate?: boolean;
  delayMs?: number;
}

const SIGNIFICANCE_STYLE: Record<string, { label: string; color: string }> = {
  forte: { label: "Forte correlazione", color: "#059669" },
  moderata: { label: "Correlazione moderata", color: "var(--azzurro)" },
  preliminare: { label: "Tendenza preliminare", color: "var(--inchiostro-50)" },
  insufficiente: { label: "Dati insufficienti", color: "var(--inchiostro-35)" },
};

export function PersonalCorrelationsCard({ data, animate = true, delayMs = 0 }: PersonalCorrelationsCardProps) {
  const [showRuns, setShowRuns] = useState(false);
  const isAccumulating = data.status === "dati_insufficienti";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 1. Header & Summary Card */}
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
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
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
            Correlazioni Personali
          </p>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background: data.status_color.startsWith("var") ? data.status_color : data.status_color,
              color: data.status_color === "var(--azzurro)" ? "var(--inchiostro)" : "#ffffff",
            }}
          >
            {data.status_label}
          </span>
        </div>

        <p style={{ font: "600 20px/1.2 var(--font-sans)", letterSpacing: "-.01em", margin: "10px 0 6px" }}>
          {data.headline}
        </p>
        <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.45 }}>
          {data.summary}
        </p>

        {isAccumulating && (
          <p className="font-serif-italic" style={{ fontSize: 12.5, color: "var(--inchiostro-50)", marginTop: 12 }}>
            Continua ad indossare l&apos;orologio di notte e a correre: ogni notte registrata arricchisce il quadro statistico.
          </p>
        )}
      </SlideUp>

      {/* 2. Insights List */}
      {!isAccumulating && data.insights.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.insights.map((ins, i) => {
            const sig = SIGNIFICANCE_STYLE[ins.significance] ?? SIGNIFICANCE_STYLE.preliminare;
            return (
              <SlideUp
                key={ins.title}
                active={animate}
                delayMs={delayMs + 60 + i * 50}
                style={{
                  background: "var(--crema-card)",
                  borderRadius: "var(--radius-card-lg)",
                  padding: 18,
                  border: "1px solid rgba(34, 34, 34, 0.06)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
                    {ins.title}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 600, color: sig.color }}>
                    {sig.label}
                  </span>
                </div>

                <p style={{ font: "600 16px/1.25 var(--font-sans)", margin: "4px 0 8px", color: "var(--inchiostro)" }}>
                  {ins.headline}
                </p>

                {/* Comparison chips */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
                  <div style={{ background: "rgba(16, 185, 129, 0.08)", padding: "8px 12px", borderRadius: "var(--radius-card)" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#047857", textTransform: "uppercase" }}>
                      {ins.good_band_label}
                    </span>
                    <p className="font-mono" style={{ fontSize: 13, fontWeight: 700, margin: "3px 0 0", color: "#064e3b" }}>
                      {ins.good_band_avg}
                    </p>
                  </div>
                  <div style={{ background: "rgba(34, 34, 34, 0.04)", padding: "8px 12px", borderRadius: "var(--radius-card)" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--inchiostro-50)", textTransform: "uppercase" }}>
                      {ins.bad_band_label}
                    </span>
                    <p className="font-mono" style={{ fontSize: 13, fontWeight: 700, margin: "3px 0 0", color: "var(--inchiostro-70)" }}>
                      {ins.bad_band_avg}
                    </p>
                  </div>
                </div>

                <p style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "8px 0 6px", lineHeight: 1.4 }}>
                  {ins.finding}
                </p>

                <p className="font-serif-italic" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0, lineHeight: 1.35 }}>
                  💡 <strong>Cosa significa:</strong> {ins.action}
                </p>

                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(34, 34, 34, 0.04)", fontSize: 10, color: "var(--inchiostro-35)" }}>
                  Basato su {ins.sample_size} sedute {ins.correlation_r != null ? `· r = ${ins.correlation_r}` : ""}
                </div>
              </SlideUp>
            );
          })}
        </div>
      )}

      {/* 3. Toggle recent paired days */}
      {data.paired_runs.length > 0 && (
        <SlideUp active={animate} delayMs={delayMs + 180}>
          <button
            type="button"
            onClick={() => setShowRuns(!showRuns)}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--inchiostro-50)",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            {showRuns ? "Nascondi storico sedute abbinate" : `Vedi le ultime ${data.paired_runs.length} sedute incrociate`}
          </button>

          {showRuns && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {data.paired_runs.map((r, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--crema-card)",
                    borderRadius: "var(--radius-card)",
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontSize: 11.5,
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, color: "var(--inchiostro)" }}>{r.title}</span>
                    <span style={{ color: "var(--inchiostro-50)", marginLeft: 6 }}>{r.date}</span>
                  </div>
                  <div style={{ display: "flex", gap: 12, fontFamily: "monospace" }}>
                    {r.sleep_hours != null && <span>💤 {r.sleep_hours}h</span>}
                    {r.hrv_ms != null && <span>⚡ {Math.round(r.hrv_ms)}ms</span>}
                    <span style={{ fontWeight: 600 }}>{r.pace_formatted}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SlideUp>
      )}
    </div>
  );
}
