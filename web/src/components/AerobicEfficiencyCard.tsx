"use client";

import { useMemo, useState } from "react";
import type { AerobicEfficiencyData, EFPoint } from "@/lib/types";
import { SlideUp } from "./motion/primitives";
import { Explainer } from "./BodyCards";
import { useAthleteLevel } from "@/lib/queries";
import { TrendUpIcon, TrendDownIcon, TrendFlatIcon, ChevronRight } from "@/components/Icons";

interface AerobicEfficiencyCardProps {
  data: AerobicEfficiencyData;
  animate?: boolean;
  level?: number;
}


const TREND_CONFIG = {
  miglioramento: {
    Icon: TrendUpIcon,
    label: "In miglioramento",
    color: "var(--verde-testo)",
    bg: "var(--verde)",
    border: "var(--border-airbnb)",
  },
  stabile: {
    Icon: TrendFlatIcon,
    label: "Stabile",
    color: "var(--inchiostro-70)",
    bg: "var(--crema-card)",
    border: "var(--border-airbnb)",
  },
  calo: {
    Icon: TrendDownIcon,
    label: "In calo",
    color: "var(--rosso-testo)",
    bg: "var(--rosa-avviso)",
    border: "var(--border-airbnb)",
  },
};


function formatPace(minPerKm: number): string {
  const mins = Math.floor(minPerKm);
  const secs = Math.round((minPerKm - mins) * 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AerobicEfficiencyCard({ data, animate = true, level: levelProp }: AerobicEfficiencyCardProps) {
  const { trend, history, findings } = data;
  const athleteLevelQuery = useAthleteLevel();
  const athleteLevel = levelProp ?? athleteLevelQuery.data?.level ?? 2;
  const isLevel1 = athleteLevel === 1;
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(!isLevel1);

  // Build sparkline
  const sparkline = useMemo(() => {
    if (history.length < 3) return null;

    const width = 600;
    const height = 100;
    const pad = { top: 12, bottom: 16, left: 8, right: 8 };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;

    const efValues = history.map((p) => p.ef);
    const minEf = Math.min(...efValues) * 0.97;
    const maxEf = Math.max(...efValues) * 1.03;
    const range = maxEf - minEf || 0.001;

    const getX = (i: number) => pad.left + (i / Math.max(1, history.length - 1)) * innerW;
    const getY = (ef: number) => pad.top + innerH - ((ef - minEf) / range) * innerH;

    const pathD = history
      .map((p, i) => `${i === 0 ? "M" : "L"} ${getX(i).toFixed(1)},${getY(p.ef).toFixed(1)}`)
      .join(" ");

    // Area fill (path down to bottom)
    const areaD = `${pathD} L ${getX(history.length - 1).toFixed(1)},${(height - pad.bottom).toFixed(1)} L ${getX(0).toFixed(1)},${(height - pad.bottom).toFixed(1)} Z`;

    // Decoupling dots (runs with decoupling computed)
    const decouplingDots = history
      .map((p, i) => (p.decoupling_pct != null ? { x: getX(i), y: getY(p.ef), pct: p.decoupling_pct, ...p } : null))
      .filter(Boolean) as Array<{ x: number; y: number; pct: number; date: string }>;

    return {
      width,
      height,
      pathD,
      areaD,
      decouplingDots,
      dates: [history[0]?.date, history[history.length - 1]?.date],
    };
  }, [history]);

  // Most recent long run with decoupling
  const recentDecoupling = useMemo(() => {
    const withDec = history.filter((p): p is EFPoint & { decoupling_pct: number } => p.decoupling_pct != null);
    return withDec.length > 0 ? withDec[withDec.length - 1] : null;
  }, [history]);

  if (!trend && history.length === 0) {
    return (
      <SlideUp
        active={animate}
        delayMs={340}
        style={{
          background: "var(--crema-card)",
          borderRadius: "var(--radius-card-lg)",
          padding: 18,
          border: "var(--border-airbnb)",
          boxShadow: "var(--shadow-airbnb-subtle)",
        }}
      >
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            margin: "0 0 8px",
            color: "var(--inchiostro-50)",
          }}
        >
          Efficienza Aerobica
        </p>
        <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: 0 }}>
          Non ci sono ancora abbastanza corse facili con dati di frequenza cardiaca per calcolare l&apos;efficienza aerobica.
        </p>
      </SlideUp>
    );
  }

  const trendConfig = trend ? TREND_CONFIG[trend.classification] ?? TREND_CONFIG.stabile : TREND_CONFIG.stabile;
  const TrendIcon = trendConfig.Icon;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 1. Header + Trend Summary */}
      <SlideUp
        active={animate}
        delayMs={340}
        style={{
          background: "linear-gradient(180deg, #f6fbf7 0%, var(--crema-card) 100%)",
          borderRadius: "var(--radius-card-lg)",
          padding: 18,
          border: "1px solid rgba(16, 185, 129, 0.22)",
          boxShadow: "var(--shadow-airbnb-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14 }}>⚡</span>
            <p
              style={{
                fontSize: 12,
                fontWeight: 700,
                margin: 0,
                color: "var(--verde-testo)",
              }}
            >
              Efficienza & Deriva Cardiaca
            </p>
          </div>
          {trend && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 12,
                fontWeight: 700,
                padding: "3px 10px",
                borderRadius: "var(--radius-pill)",
                background: trendConfig.bg,
                color: trendConfig.color,
                border: trendConfig.border,
              }}
            >
              <TrendIcon size={12} strokeWidth={2.4} />
              {trendConfig.label}
            </span>
          )}
        </div>

        {/* Level 1 Simplified Motivating Cue */}
        {isLevel1 ? (
          <div style={{ margin: "10px 0 14px" }}>
            <p style={{ font: "600 17px/1.25 var(--font-sans)", margin: "0 0 6px" }}>
              {trend?.classification === "miglioramento"
                ? "Il tuo motore aerobico sta crescendo bene"
                : trend?.classification === "calo"
                ? "Momento di consolidare il ritmo facile"
                : "Base aerobica stabile e costante"}
            </p>
            <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.4 }}>
              {trend?.classification === "miglioramento"
                ? "A parità di battiti cardiaci stai correndo più velocemente rispetto al mese scorso."
                : trend?.classification === "calo"
                ? "I battiti tendono a salire un po' prima: mantieni le corse facili davvero lente e riposa."
                : "Mantieni la costanza nelle corse tranquille senza forzare il ritmo."}
            </p>
            <button data-track="aerobic-efficiency-card.setshowtechnicaldetails"
              type="button"
              onClick={() => setShowTechnicalDetails((v) => !v)}
              className="press-soft"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                marginTop: 12,
                background: "transparent",
                border: "none",
                padding: 0,
                fontSize: 12,
                fontWeight: 600,
                color: "var(--inchiostro-50)",
                cursor: "pointer",
              }}
            >
              {showTechnicalDetails ? "Nascondi numeri tecnici" : "Mostra parametri tecnici (EF, Decoupling)"}
              <ChevronRight size={13} style={{ transform: showTechnicalDetails ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform 0.2s" }} />
            </button>
          </div>
        ) : null}

        {/* Main metrics row (Visible for L2/L3 or when expanded in L1) */}
        {trend && (!isLevel1 || showTechnicalDetails) && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "14px 0" }}>
            {/* EF attuale */}
            <div style={{ background: "var(--azzurro)", padding: 12, borderRadius: "var(--radius-card)", border: "var(--border-airbnb)" }}>
              <span style={{ fontSize: 12, color: "var(--azzurro-testo)", fontWeight: 700, }}>
                EF attuale
              </span>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px", color: "var(--inchiostro)" }}>
                {(trend.current_ef * 1000).toFixed(1)}
              </p>
              <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>m/s per bpm × 10³</span>
            </div>

            {/* Variazione 4 settimane */}
            <div style={{ background: trendConfig.bg, padding: 12, borderRadius: "var(--radius-card)", border: trendConfig.border }}>
              <span style={{ fontSize: 12, color: trendConfig.color, fontWeight: 700, }}>
                Δ 4 settimane
              </span>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 700, margin: "4px 0 2px", color: trendConfig.color }}>
                {trend.change_pct > 0 ? "+" : ""}
                {trend.change_pct.toFixed(1)}%
              </p>
              <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>rispetto a 4 sett. fa</span>
            </div>

            {/* Decoupling ultimo lungo */}
            <div
              style={{
                background: recentDecoupling
                  ? recentDecoupling.decoupling_pct < 5
                    ? "var(--verde)"
                    : "var(--rosa-avviso)"
                  : "rgba(34, 34, 34, 0.03)",
                padding: 12,
                borderRadius: "var(--radius-card)",
                border: "var(--border-airbnb)",
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: recentDecoupling
                    ? recentDecoupling.decoupling_pct < 5
                      ? "var(--verde-testo)"
                      : "var(--rosso-testo)"
                    : "var(--inchiostro-50)",
                }}
              >
                Deriva (Decoupling)
              </span>
              <p
                className="font-mono"
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  margin: "4px 0 2px",
                  color: recentDecoupling
                    ? recentDecoupling.decoupling_pct < 5
                      ? "var(--verde-testo)"
                      : "var(--rosso-testo)"
                    : "var(--inchiostro-35)",
                }}
              >
                {recentDecoupling ? `${recentDecoupling.decoupling_pct.toFixed(1)}%` : "—"}
              </p>
              <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>
                {recentDecoupling ? (recentDecoupling.decoupling_pct < 5 ? "cuore stabile (<5%)" : "deriva alta (>5%)") : "nessun lungo"}
              </span>
            </div>
          </div>
        )}

        {/* Explanation */}
        {(!isLevel1 || showTechnicalDetails) && (
          <Explainer track="aerobic-efficiency-card.explainer">
            L&apos;efficienza (EF) è quanta strada fai per ogni battito: se sale, corri più veloce allo stesso sforzo. La
            deriva misura se il cuore accelera nella seconda metà dei lunghi a parità di passo: sotto il 5% il motore
            aerobico tiene senza affanno.
          </Explainer>
        )}
      </SlideUp>

      {/* 2. Sparkline Chart */}
      {sparkline && (!isLevel1 || showTechnicalDetails) && (
        <SlideUp
          active={animate}
          delayMs={400}
          style={{
            background: "var(--crema-card)",
            borderRadius: "var(--radius-card-lg)",
            padding: 16,
            border: "var(--border-airbnb)",
            boxShadow: "var(--shadow-airbnb-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro-70)" }}>Andamento EF</span>
            <div style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--inchiostro-50)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 2.5, background: "var(--azzurro-tratto)" }} /> EF
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--rosso-avviso)" }} /> Lungo
              </span>
            </div>
          </div>

          <div style={{ width: "100%", overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${sparkline.width} ${sparkline.height}`}
              style={{ width: "100%", height: "auto", minHeight: 80, display: "block" }}
            >
              {/* Area fill */}
              <path d={sparkline.areaD} fill="var(--azzurro)" />
              {/* Line */}
              <path d={sparkline.pathD} fill="none" stroke="var(--azzurro-tratto)" strokeWidth={2.5} strokeLinecap="round" />
              {/* Decoupling dots on long runs */}
              {sparkline.decouplingDots.map((dot, i) => (
                <circle
                  key={i}
                  cx={dot.x}
                  cy={dot.y}
                  r={4}
                  fill={dot.pct < 5 ? "var(--verde-tratto-scuro)" : "var(--rosso-avviso)"}
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              ))}
            </svg>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: 4,
              fontSize: 12,
              color: "var(--inchiostro-35)",
              fontFamily: "monospace",
            }}
          >
            <span>{sparkline.dates[0]}</span>
            <span>{sparkline.dates[1]}</span>
          </div>
        </SlideUp>
      )}

      {/* 3. Findings */}
      {findings.length > 0 && (
        <SlideUp
          active={animate}
          delayMs={460}
          style={{
            background: "var(--crema-card)",
            borderRadius: "var(--radius-card-lg)",
            padding: 18,
            border: "var(--border-airbnb)",
            boxShadow: "var(--shadow-airbnb-subtle)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {findings.map((f) => (
              <div key={f.key}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: f.severity === "attenzione" ? "var(--rosso-avviso)" : "var(--verde-tratto-scuro)",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--inchiostro)" }}>{f.headline}</span>
                </div>
                <p style={{ fontSize: 12, color: "var(--inchiostro-70)", margin: "0 0 2px", paddingLeft: 12 }}>
                  {f.measured}
                </p>
                {f.action && (
                  <p className="font-serif-italic" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0, paddingLeft: 12 }}>
                    {f.action}
                  </p>
                )}
              </div>
            ))}
          </div>
        </SlideUp>
      )}
    </div>
  );
}
