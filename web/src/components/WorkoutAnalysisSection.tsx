"use client";

import { useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { RaceAnalysisCard } from "@/components/RaceAnalysisCard";
import type { CausalFinding, StreamBreakpoint, WorkoutAnalysis, WorkoutSegment } from "@/lib/types";

const CATEGORY_STYLE: Record<
  CausalFinding["category"],
  { background: string; color: string; label: string }
> = {
  sensore: { background: "var(--lilla)", color: "var(--inchiostro)", label: "Sensore / Strumento" },
  meccanica: { background: "var(--azzurro)", color: "var(--azzurro-testo)", label: "Biomeccanica" },
  pacing: { background: "var(--corallo)", color: "var(--corallo-testo)", label: "Gestione Ritmo" },
  metabolica: { background: "var(--giallo)", color: "var(--giallo-testo)", label: "Energia & Nutrizione" },
  fisiologica: { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", label: "Recupero & Vigilia" },
  salita: { background: "var(--verde)", color: "var(--verde-testo)", label: "Pendenze & Salita" },
};

export function WorkoutAnalysisSection({
  analysis,
  narrativeText,
  animate,
}: {
  analysis: WorkoutAnalysis | null | undefined;
  narrativeText?: string;
  animate: boolean;
}) {
  const [showSplits, setShowSplits] = useState(false);

  if (!analysis) return null;

  const hasAnomalies = analysis.breakpoints.length > 0;
  const hasFindings = analysis.findings.length > 0;

  return (
    <div style={{ marginTop: 28, width: "100%" }}>
      {/* Section Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--inchiostro-50)",
          }}
        >
          Analisi Profonda & Correlazioni
        </span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          secondo per secondo
        </span>
      </div>

      {/* Hero Diagnosis Card */}
      <SlideUp
        active={animate}
        delayMs={120}
        style={{
          background: "var(--inchiostro)",
          color: "var(--crema)",
          borderRadius: "var(--radius-card-lg)",
          padding: 22,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: hasAnomalies ? "var(--corallo)" : "var(--verde)",
              color: hasAnomalies ? "var(--corallo-testo)" : "var(--verde-testo)",
              borderRadius: "var(--radius-pill)",
              padding: "3px 10px",
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {hasAnomalies ? "Punto di rottura rilevato" : "Diagnosi Esecuzione"}
          </span>
        </div>

        <p style={{ font: "600 22px/1.2 var(--font-sans)", letterSpacing: "-.02em", margin: "10px 0 0" }}>
          {analysis.headline}
        </p>

        <p className="font-serif-italic" style={{ fontSize: 15.5, lineHeight: 1.4, margin: "12px 0 0", opacity: 0.9 }}>
          {narrativeText ?? analysis.summary_deterministic}
        </p>

        {/* Quick summary strip */}
        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 18,
            paddingTop: 14,
            borderTop: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.65 }}>
              Passo Medio
            </span>
            <span className="font-mono" style={{ display: "block", fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {analysis.avg_pace_formatted}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.65 }}>
              Frequenza
            </span>
            <span className="font-mono" style={{ display: "block", fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {analysis.avg_hr ? `${analysis.avg_hr} bpm` : "—"}
            </span>
          </div>
          <div style={{ flex: 1 }}>
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.65 }}>
              Eventi
            </span>
            <span className="font-mono" style={{ display: "block", fontSize: 16, fontWeight: 600, marginTop: 2 }}>
              {analysis.breakpoints.length} rilevati
            </span>
          </div>
        </div>
      </SlideUp>

      {analysis.race_analysis && (
        <RaceAnalysisCard race={analysis.race_analysis} reliability={analysis.hr_reliability} animate={animate} />
      )}

      {/* Breakpoints / Chronological Events Timeline */}
      {hasAnomalies && (
        <div style={{ marginTop: 18 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--inchiostro-50)",
              display: "block",
              marginBottom: 8,
            }}
          >
            Punti di Svolta lungo il percorso
          </span>
          <WorkoutTimelineTrack breakpoints={analysis.breakpoints} segments={analysis.segments ?? []} />
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {analysis.breakpoints.map((bp, i) => (
              <BreakpointCard key={i} breakpoint={bp} animate={animate} delayMs={140 + i * 40} />
            ))}
          </div>
        </div>
      )}

      {/* Causal Findings & Coaching Actions */}
      {hasFindings && (
        <div style={{ marginTop: 20 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              color: "var(--inchiostro-50)",
              display: "block",
              marginBottom: 8,
            }}
          >
            Perché è successo & Come migliorare
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {analysis.findings.map((finding, i) => (
              <FindingDetailCard key={finding.key} finding={finding} animate={animate} delayMs={180 + i * 50} />
            ))}
          </div>
        </div>
      )}

      {/* Mechanics Evolution: Splits per 5km */}
      {/* The race analysis has its own 5 km blocks; showing these too would say it twice. */}
      {!analysis.race_analysis && analysis.segments && analysis.segments.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            onClick={() => setShowSplits((s) => !s)}
            className="press-soft"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              background: "var(--crema-card)",
              border: "1px solid var(--border-airbnb)",
              borderRadius: "var(--radius-card)",
              padding: "13px 16px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div>
              <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--inchiostro)", display: "block" }}>
                Progressione Meccanica (Passo, Cadenza, Falcata)
              </span>
              <span style={{ fontSize: 11.5, color: "var(--inchiostro-50)" }}>
                {analysis.segments.length} blocchi analizzati
              </span>
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
              {showSplits ? "Nascondi" : "Mostra dati"}
            </span>
          </button>

          {showSplits && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {analysis.segments.map((seg, i) => (
                <SegmentRow key={i} segment={seg} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function BreakpointCard({
  breakpoint,
  animate,
  delayMs,
}: {
  breakpoint: StreamBreakpoint;
  animate: boolean;
  delayMs: number;
}) {
  const min = Math.round(breakpoint.time_sec / 60);

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: "var(--crema-card)",
        border: "1px solid var(--border-airbnb)",
        borderRadius: "var(--radius-card)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              background: "var(--corallo)",
              color: "var(--corallo-testo)",
              borderRadius: "var(--radius-pill)",
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 700,
            }}
          >
            Minuto {min} · {breakpoint.distance_km} km
          </span>
          <p style={{ fontWeight: 600, fontSize: 14, margin: 0, color: "var(--inchiostro)" }}>
            {breakpoint.headline}
          </p>
        </div>
      </div>

      <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.4 }}>
        {breakpoint.detail}
      </p>

      {/* Snapshot before vs after */}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {Object.entries(breakpoint.before_metrics).map(([k, v]) => (
          <div
            key={k}
            style={{
              flex: 1,
              background: "var(--sabbia)",
              borderRadius: "var(--radius-chip)",
              padding: "8px 10px",
            }}
          >
            <span style={{ fontSize: 9.5, textTransform: "uppercase", color: "var(--inchiostro-50)", display: "block" }}>
              Prima ({k})
            </span>
            <span className="font-mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--inchiostro)" }}>
              {v}
            </span>
          </div>
        ))}
        {Object.entries(breakpoint.after_metrics).map(([k, v]) => (
          <div
            key={k}
            style={{
              flex: 1,
              background: "rgba(232, 93, 78, 0.12)",
              borderRadius: "var(--radius-chip)",
              padding: "8px 10px",
            }}
          >
            <span style={{ fontSize: 9.5, textTransform: "uppercase", color: "var(--corallo-testo)", display: "block" }}>
              Dopo ({k})
            </span>
            <span className="font-mono" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--corallo-testo)" }}>
              {v}
            </span>
          </div>
        ))}
      </div>
    </SlideUp>
  );
}

function FindingDetailCard({
  finding,
  animate,
  delayMs,
}: {
  finding: CausalFinding;
  animate: boolean;
  delayMs: number;
}) {
  const cat = CATEGORY_STYLE[finding.category] ?? CATEGORY_STYLE.fisiologica;

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: "var(--crema-card)",
        border: "1px solid var(--border-airbnb)",
        borderRadius: "var(--radius-card)",
        padding: "16px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p style={{ fontWeight: 700, fontSize: 15, margin: 0, color: "var(--inchiostro)" }}>
          {finding.title}
        </p>
        <span
          style={{
            background: cat.background,
            color: cat.color,
            borderRadius: "var(--radius-pill)",
            padding: "3px 9px",
            fontSize: 10,
            fontWeight: 700,
            whiteSpace: "nowrap",
            flex: "none",
          }}
        >
          {cat.label}
        </span>
      </div>

      {/* What happened */}
      <p style={{ fontSize: 13, color: "var(--inchiostro)", margin: "8px 0 0", lineHeight: 1.45 }}>
        <strong style={{ fontWeight: 600 }}>Cosa è successo:</strong> {finding.what_happened}
      </p>

      {/* Why it happened */}
      <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.4 }}>
        <strong style={{ fontWeight: 600, fontStyle: "normal" }}>Perché:</strong> {finding.why_it_happened}
      </p>

      {/* Supporting metrics */}
      {finding.supporting_metrics && finding.supporting_metrics.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          {finding.supporting_metrics.map((sm, i) => (
            <div
              key={i}
              style={{
                background: "var(--sabbia-chip)",
                borderRadius: "var(--radius-chip)",
                padding: "6px 10px",
                fontSize: 11.5,
              }}
            >
              <span style={{ color: "var(--inchiostro-50)" }}>{sm.label}: </span>
              <strong className="font-mono" style={{ color: "var(--inchiostro)", fontWeight: 600 }}>
                {sm.value}
              </strong>
            </div>
          ))}
        </div>
      )}

      {/* Action / How to improve */}
      {finding.how_to_improve && (
        <div
          style={{
            background: "var(--sabbia)",
            borderRadius: "var(--radius-chip)",
            padding: "11px 13px",
            marginTop: 12,
          }}
        >
          <span
            style={{
              display: "block",
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".04em",
              color: "var(--inchiostro-50)",
              marginBottom: 3,
            }}
          >
            Cosa fare nella prossima uscita
          </span>
          <p style={{ fontSize: 13, color: "var(--inchiostro)", margin: 0, lineHeight: 1.4 }}>
            {finding.how_to_improve}
          </p>
        </div>
      )}
    </SlideUp>
  );
}

function SegmentRow({ segment }: { segment: WorkoutSegment }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "var(--crema-card)",
        border: "1px solid var(--border-airbnb)",
        borderRadius: "var(--radius-row)",
        padding: "10px 14px",
        fontSize: 12,
      }}
    >
      <div style={{ width: 75 }}>
        <span style={{ fontWeight: 700, color: "var(--inchiostro)" }}>{segment.label}</span>
      </div>

      <div style={{ flex: 1, display: "flex", justifyContent: "space-around", gap: 8 }}>
        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 9.5, color: "var(--inchiostro-50)", display: "block" }}>Passo</span>
          <span className="font-mono" style={{ fontWeight: 600 }}>{segment.avg_pace_formatted}</span>
        </div>

        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 9.5, color: "var(--inchiostro-50)", display: "block" }}>FC</span>
          <span className="font-mono" style={{ fontWeight: 600 }}>{segment.avg_hr ? `${segment.avg_hr} bpm` : "—"}</span>
        </div>

        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 9.5, color: "var(--inchiostro-50)", display: "block" }}>Cadenza</span>
          <span className="font-mono" style={{ fontWeight: 600 }}>{segment.avg_cadence ? `${segment.avg_cadence} spm` : "—"}</span>
        </div>

        <div style={{ textAlign: "center" }}>
          <span style={{ fontSize: 9.5, color: "var(--inchiostro-50)", display: "block" }}>Falcata</span>
          <span className="font-mono" style={{ fontWeight: 600 }}>{segment.avg_stride_m ? `${segment.avg_stride_m} m` : "—"}</span>
        </div>
      </div>
    </div>
  );
}

function WorkoutTimelineTrack({
  breakpoints,
  segments,
}: {
  breakpoints: StreamBreakpoint[];
  segments: WorkoutSegment[];
}) {
  const lastSegmentEndKm = segments[segments.length - 1]?.end_km ?? 0;
  const maxBreakpointSec = Math.max(...breakpoints.map((b) => b.time_sec), 0);
  const maxSec = Math.max(maxBreakpointSec, lastSegmentEndKm * 320, 3600);
  const totalMin = Math.round(maxSec / 60);

  return (
    <div
      style={{
        background: "var(--crema-card)",
        border: "1px solid var(--border-airbnb)",
        borderRadius: "var(--radius-card)",
        padding: "14px 16px 12px",
        marginBottom: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--inchiostro-50)" }}>
          Mappa temporale della seduta
        </span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          0&apos; → {totalMin}&apos;
        </span>
      </div>

      <div style={{ position: "relative", height: 28, display: "flex", alignItems: "center" }}>
        {/* Track Line */}
        <div style={{ position: "absolute", left: 0, right: 0, height: 6, borderRadius: 3, background: "var(--sabbia-chip)" }} />

        {/* Stable Green Base */}
        <div
          style={{
            position: "absolute",
            left: 0,
            width: `${Math.min(100, Math.max(5, ((breakpoints[0]?.time_sec ?? maxSec) / maxSec) * 100))}%`,
            height: 6,
            borderRadius: 3,
            background: "var(--verde)",
          }}
        />

        {/* Breakpoints markers */}
        {breakpoints.map((bp, idx) => {
          const pct = Math.min(95, Math.max(5, (bp.time_sec / maxSec) * 100));
          const min = Math.round(bp.time_sec / 60);
          return (
            <div
              key={idx}
              style={{
                position: "absolute",
                left: `${pct}%`,
                transform: "translateX(-50%)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                cursor: "pointer",
              }}
              title={`${bp.headline} (${min}' · ${bp.distance_km} km)`}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: "var(--font-dm-mono)",
                  background: "var(--corallo)",
                  color: "var(--corallo-testo)",
                  padding: "1px 5px",
                  borderRadius: 6,
                  whiteSpace: "nowrap",
                  marginBottom: 2,
                }}
              >
                {min}&apos;
              </span>
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: "var(--corallo-accent)",
                  border: "2px solid #fff",
                  boxShadow: "0 0 5px rgba(232, 93, 78, 0.4)",
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
