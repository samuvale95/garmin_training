"use client";

import { useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { MoonIcon, LightningIcon } from "@/components/Icons";
import type { PersonalCorrelationsData } from "@/lib/types";

interface PersonalCorrelationsCardProps {
  data: PersonalCorrelationsData;
  animate?: boolean;
  delayMs?: number;
}

const SIGNIFICANCE_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  forte: { label: "Forte impatto", color: "#4f46e5", bg: "rgba(79, 70, 229, 0.1)" },
  moderata: { label: "Impatto evidente", color: "#6366f1", bg: "rgba(99, 102, 241, 0.1)" },
  preliminare: { label: "Tendenza iniziale", color: "var(--inchiostro-70)", bg: "rgba(34, 34, 34, 0.05)" },
  insufficiente: { label: "Pochi dati registrati", color: "var(--inchiostro-50)", bg: "rgba(34, 34, 34, 0.04)" },
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
          background: "linear-gradient(180deg, #fbfaff 0%, var(--crema-card) 100%)",
          borderRadius: "var(--radius-card-lg)",
          padding: 20,
          border: "1px solid rgba(129, 140, 248, 0.22)",
          boxShadow: "var(--shadow-airbnb-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>🧬</span>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                margin: 0,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                color: "#4338ca",
              }}
            >
              Impatto Sonno & HRV
            </p>
          </div>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: "var(--radius-pill)",
              background: "rgba(99, 102, 241, 0.12)",
              color: "#4338ca",
            }}
          >
            {data.status === "dati_insufficienti" ? "Raccolta dati" : "90 giorni"}
          </span>
        </div>

        <p style={{ font: "600 19px/1.25 var(--font-sans)", letterSpacing: "-.01em", margin: "10px 0 6px", color: "var(--inchiostro)" }}>
          {data.headline}
        </p>
        <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.45 }}>
          {data.summary}
        </p>

        {isAccumulating && (
          <p className="font-serif-italic" style={{ fontSize: 12.5, color: "var(--inchiostro-50)", marginTop: 12 }}>
            Indossa l&apos;orologio di notte: bastano poche settimane per capire come il sonno influenza i tuoi ritmi.
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
                  border: "1px solid rgba(129, 140, 248, 0.18)",
                  boxShadow: "var(--shadow-airbnb-subtle)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#4338ca" }}>
                    {ins.title}
                  </span>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: sig.color,
                      background: sig.bg,
                      padding: "2px 8px",
                      borderRadius: "var(--radius-pill)",
                    }}
                  >
                    {sig.label}
                  </span>
                </div>

                <p style={{ font: "600 16px/1.25 var(--font-sans)", margin: "4px 0 8px", color: "var(--inchiostro)" }}>
                  {ins.headline}
                </p>

                {/* Comparison chips */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, margin: "10px 0" }}>
                  <div style={{ background: "rgba(16, 185, 129, 0.08)", padding: "10px 12px", borderRadius: "var(--radius-card)", border: "1px solid rgba(16, 185, 129, 0.2)" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#047857", textTransform: "uppercase" }}>
                      {ins.good_band_label}
                    </span>
                    <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, margin: "3px 0 0", color: "#064e3b" }}>
                      {ins.good_band_avg}
                    </p>
                  </div>
                  <div style={{ background: "rgba(239, 68, 68, 0.06)", padding: "10px 12px", borderRadius: "var(--radius-card)", border: "1px solid rgba(239, 68, 68, 0.18)" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b91c1c", textTransform: "uppercase" }}>
                      {ins.bad_band_label}
                    </span>
                    <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, margin: "3px 0 0", color: "#7f1d1d" }}>
                      {ins.bad_band_avg}
                    </p>
                  </div>
                </div>

                <p style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "8px 0 6px", lineHeight: 1.4 }}>
                  {ins.finding}
                </p>

                <p className="font-serif-italic" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0, lineHeight: 1.35 }}>
                  <span style={{ fontWeight: 600, color: "var(--inchiostro-70)" }}>Consiglio:</span> {ins.action}
                </p>

                <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px solid rgba(34, 34, 34, 0.05)", fontSize: 10, color: "var(--inchiostro-35)" }}>
                  Confronto su {ins.sample_size} corse analizzate con la notte precedente
                </div>
              </SlideUp>
            );
          })}
        </div>
      )}

      {/* 3. Toggle recent paired days */}
      {data.paired_runs.length > 0 && (
        <SlideUp active={animate} delayMs={delayMs + 180}>
          <button data-track="personal-correlations-card.setshowruns"
            type="button"
            onClick={() => setShowRuns(!showRuns)}
            style={{
              background: "none",
              border: "none",
              padding: "4px 0",
              fontSize: 12.5,
              fontWeight: 600,
              color: "#4f46e5",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 5,
            }}
          >
            <span>{showRuns ? "Nascondi storico corse & sonno" : `Vedi le ultime ${data.paired_runs.length} corse messe a confronto con la notte prima`}</span>
          </button>

          {showRuns && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {data.paired_runs.map((r, i) => (
                <div
                  key={i}
                  style={{
                    background: "var(--crema-card)",
                    borderRadius: "var(--radius-card)",
                    border: "var(--border-airbnb)",
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
                  <div style={{ display: "flex", gap: 12, alignItems: "center", fontFamily: "monospace" }}>
                    {r.sleep_hours != null && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <MoonIcon size={11} strokeWidth={2} style={{ color: "#4f46e5" }} />
                        <span>{r.sleep_hours}h</span>
                      </span>
                    )}
                    {r.hrv_ms != null && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
                        <LightningIcon size={11} strokeWidth={2.2} style={{ color: "#059669" }} />
                        <span>{Math.round(r.hrv_ms)}ms</span>
                      </span>
                    )}
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
