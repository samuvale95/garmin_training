"use client";

import { useMemo, useState } from "react";
import type { FitnessFatigueData, FitnessFatiguePoint } from "@/lib/types";
import { SlideUp } from "./motion/primitives";

interface FitnessFatigueCardProps {
  data: FitnessFatigueData;
  animate?: boolean;
}

export function FitnessFatigueCard({ data, animate = true }: FitnessFatigueCardProps) {
  const [activeTab, setActiveTab] = useState<"all" | "tsb" | "load">("all");
  const current = data.current;
  const assessment = data.race_assessment;

  // Combine history (past 45 days) and projection for chart
  const points = useMemo(() => {
    const hist = data.history.slice(-45);
    return [...hist, ...data.projection];
  }, [data.history, data.projection]);

  // Chart coordinates
  const chart = useMemo(() => {
    if (!points.length) return null;

    const width = 600;
    const height = 180;
    const padding = { top: 16, bottom: 24, left: 10, right: 10 };

    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    const allValues = points.flatMap((p) => [p.ctl, p.atl, p.tsb]);
    const minVal = Math.min(-35, Math.floor(Math.min(...allValues) / 10) * 10);
    const maxVal = Math.max(80, Math.ceil(Math.max(...allValues) / 10) * 10);
    const valRange = maxVal - minVal || 1;

    const getY = (val: number) => padding.top + innerHeight - ((val - minVal) / valRange) * innerHeight;
    const getX = (idx: number) => padding.left + (idx / Math.max(1, points.length - 1)) * innerWidth;

    const zeroY = getY(0);
    const optMinY = getY(-25);
    const optMaxY = getY(-10);
    const freshMinY = getY(5);
    const freshMaxY = getY(20);

    const todayIdx = points.findIndex((p) => p.date === current.date);
    const todayX = todayIdx >= 0 ? getX(todayIdx) : null;

    const makePath = (accessor: (p: FitnessFatiguePoint) => number, sliceStart = 0, sliceEnd?: number) => {
      const subset = points.slice(sliceStart, sliceEnd);
      if (!subset.length) return "";
      return subset.reduce((acc, p, i) => {
        const x = getX(sliceStart + i);
        const y = getY(accessor(p));
        return `${acc} ${i === 0 ? "M" : "L"} ${x.toFixed(1)},${y.toFixed(1)}`;
      }, "");
    };

    const histLen = data.history.slice(-45).length;

    return {
      width,
      height,
      padding,
      zeroY,
      optMinY,
      optMaxY,
      freshMinY,
      freshMaxY,
      todayX,
      ctlHistPath: makePath((p) => p.ctl, 0, histLen),
      ctlProjPath: makePath((p) => p.ctl, Math.max(0, histLen - 1)),
      atlHistPath: makePath((p) => p.atl, 0, histLen),
      atlProjPath: makePath((p) => p.atl, Math.max(0, histLen - 1)),
      tsbHistPath: makePath((p) => p.tsb, 0, histLen),
      tsbProjPath: makePath((p) => p.tsb, Math.max(0, histLen - 1)),
      dates: [
        points[0]?.date,
        points[Math.floor(points.length / 2)]?.date,
        points[points.length - 1]?.date,
      ],
    };
  }, [points, current.date, data.history]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 1. Main Metrics Card */}
      <SlideUp
        active={animate}
        delayMs={160}
        style={{
          background: "var(--crema-card)",
          borderRadius: "var(--radius-card-lg)",
          padding: 18,
          border: "1px solid rgba(34, 34, 34, 0.06)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
          <p style={{ fontSize: 13, fontWeight: 700, margin: 0, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-50)" }}>
            Fitness, Fatica & Forma
          </p>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "var(--radius-pill)",
              background: current.status.color,
              color: current.status.color.startsWith("var") ? "inherit" : "#ffffff",
            }}
          >
            {current.status.label}
          </span>
        </div>

        {/* 3 Metric Columns */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, margin: "14px 0" }}>
          <div style={{ background: "rgba(59, 130, 246, 0.08)", padding: 12, borderRadius: "var(--radius-card)" }}>
            <span style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 700, textTransform: "uppercase" }}>Fitness (CTL)</span>
            <p className="font-mono" style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 2px", color: "#1e3a8a" }}>
              {current.ctl.toFixed(0)}
            </p>
            <span style={{ fontSize: 10, color: "var(--inchiostro-50)" }}>media 42 giorni</span>
          </div>

          <div style={{ background: "rgba(249, 115, 22, 0.08)", padding: 12, borderRadius: "var(--radius-card)" }}>
            <span style={{ fontSize: 11, color: "#c2410c", fontWeight: 700, textTransform: "uppercase" }}>Fatica (ATL)</span>
            <p className="font-mono" style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 2px", color: "#7c2d12" }}>
              {current.atl.toFixed(0)}
            </p>
            <span style={{ fontSize: 10, color: "var(--inchiostro-50)" }}>media 7 giorni</span>
          </div>

          <div style={{ background: current.tsb >= 0 ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.08)", padding: 12, borderRadius: "var(--radius-card)" }}>
            <span style={{ fontSize: 11, color: current.tsb >= 0 ? "#047857" : "#b91c1c", fontWeight: 700, textTransform: "uppercase" }}>Forma (TSB)</span>
            <p className="font-mono" style={{ fontSize: 24, fontWeight: 700, margin: "4px 0 2px", color: current.tsb >= 0 ? "#064e3b" : "#7f1d1d" }}>
              {current.tsb > 0 ? `+${current.tsb.toFixed(0)}` : current.tsb.toFixed(0)}
            </p>
            <span style={{ fontSize: 10, color: "var(--inchiostro-50)" }}>CTL − ATL</span>
          </div>
        </div>

        <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.45 }}>
          {current.status.caption}
        </p>
      </SlideUp>

      {/* 2. Interactive Curve Chart */}
      {chart && (
        <SlideUp
          active={animate}
          delayMs={220}
          style={{
            background: "var(--crema-card)",
            borderRadius: "var(--radius-card-lg)",
            padding: 16,
            border: "1px solid rgba(34, 34, 34, 0.06)",
          }}
        >
          {/* Chart Header & Legend */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                style={{
                  background: activeTab === "all" ? "var(--inchiostro)" : "transparent",
                  color: activeTab === "all" ? "#ffffff" : "var(--inchiostro-50)",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Tutto
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("tsb")}
                style={{
                  background: activeTab === "tsb" ? "var(--inchiostro)" : "transparent",
                  color: activeTab === "tsb" ? "#ffffff" : "var(--inchiostro-50)",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  padding: "3px 10px",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Forma (TSB)
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 10, color: "var(--inchiostro-50)" }}>
              {activeTab === "all" && (
                <>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 2.5, background: "#3b82f6" }} /> Fitness
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ width: 8, height: 2.5, background: "#f97316" }} /> Fatica
                  </span>
                </>
              )}
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 2.5, background: "#10b981" }} /> TSB
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4, opacity: 0.7 }}>
                <span style={{ width: 8, height: 0, borderTop: "2px dashed #888" }} /> Futuro
              </span>
            </div>
          </div>

          {/* SVG Multi-curve */}
          <div style={{ width: "100%", overflowX: "auto" }}>
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              style={{ width: "100%", height: "auto", minHeight: 140, display: "block" }}
            >
              {/* Shaded Freshness Band (+5 to +20) */}
              <rect
                x={chart.padding.left}
                y={Math.min(chart.freshMinY, chart.freshMaxY)}
                width={chart.width - chart.padding.left - chart.padding.right}
                height={Math.abs(chart.freshMinY - chart.freshMaxY)}
                fill="rgba(16, 185, 129, 0.08)"
              />

              {/* Shaded Optimal Build Band (-25 to -10) */}
              <rect
                x={chart.padding.left}
                y={Math.min(chart.optMinY, chart.optMaxY)}
                width={chart.width - chart.padding.left - chart.padding.right}
                height={Math.abs(chart.optMinY - chart.optMaxY)}
                fill="rgba(59, 130, 246, 0.05)"
              />

              {/* Zero TSB Line */}
              <line
                x1={chart.padding.left}
                y1={chart.zeroY}
                x2={chart.width - chart.padding.right}
                y2={chart.zeroY}
                stroke="rgba(34, 34, 34, 0.15)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />

              {/* Vertical line for Today */}
              {chart.todayX != null && (
                <>
                  <line
                    x1={chart.todayX}
                    y1={chart.padding.top}
                    x2={chart.todayX}
                    y2={chart.height - chart.padding.bottom}
                    stroke="var(--inchiostro-50)"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <text
                    x={chart.todayX}
                    y={chart.padding.top - 4}
                    textAnchor="middle"
                    fill="var(--inchiostro-50)"
                    fontSize={9}
                    fontWeight={600}
                    fontFamily="monospace"
                  >
                    OGGI
                  </text>
                </>
              )}

              {/* Curves */}
              {activeTab === "all" && (
                <>
                  {/* CTL Fitness (Blue) */}
                  <path d={chart.ctlHistPath} fill="none" stroke="#3b82f6" strokeWidth={2.2} strokeLinecap="round" />
                  <path d={chart.ctlProjPath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 4" opacity={0.7} />

                  {/* ATL Fatigue (Orange) */}
                  <path d={chart.atlHistPath} fill="none" stroke="#f97316" strokeWidth={2} strokeLinecap="round" />
                  <path d={chart.atlProjPath} fill="none" stroke="#f97316" strokeWidth={1.8} strokeDasharray="4 4" opacity={0.7} />
                </>
              )}

              {/* TSB Form (Emerald / Red) */}
              <path d={chart.tsbHistPath} fill="none" stroke="#10b981" strokeWidth={2.5} strokeLinecap="round" />
              <path d={chart.tsbProjPath} fill="none" stroke="#10b981" strokeWidth={2.2} strokeDasharray="4 4" opacity={0.8} />
            </svg>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 10, color: "var(--inchiostro-35)", fontFamily: "monospace" }}>
            <span>{chart.dates[0]}</span>
            <span>{chart.dates[1]}</span>
            <span>{chart.dates[2]}</span>
          </div>
        </SlideUp>
      )}

      {/* 3. Venice Marathon / Race Tapering Assessment */}
      {assessment && (
        <SlideUp
          active={animate}
          delayMs={300}
          style={{
            background: "var(--verde)",
            color: "var(--verde-testo)",
            borderRadius: "var(--radius-card-lg)",
            padding: 18,
            border: "var(--border-airbnb)",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
              🏁 Proiezione Gara · {assessment.race_name}
            </span>
            <span className="font-mono" style={{ fontSize: 12, fontWeight: 700 }}>
              tra {assessment.days_to_race} giorni
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 10, margin: "10px 0" }}>
            <p className="font-mono" style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>
              {assessment.projected_tsb > 0 ? `+${assessment.projected_tsb.toFixed(0)}` : assessment.projected_tsb.toFixed(0)}
            </p>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>{assessment.verdict}</p>
              <span style={{ fontSize: 11, opacity: 0.85 }}>TSB stimato al via</span>
            </div>
          </div>

          <p className="font-serif-italic" style={{ fontSize: 13.5, margin: "6px 0 0", lineHeight: 1.45 }}>
            {assessment.advice}
          </p>
        </SlideUp>
      )}
    </div>
  );
}
