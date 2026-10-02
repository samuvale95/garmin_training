"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { SlideUp } from "@/components/motion/primitives";

interface TodayVitalStripProps {
  sleepMinutes?: number | null;
  readinessScore?: number | null;
  carbLoggedG?: number | null;
  carbTargetG?: [number, number] | null;
  active?: boolean;
}

export function TodayVitalStrip({
  sleepMinutes,
  readinessScore,
  carbLoggedG,
  carbTargetG,
  active = true,
}: TodayVitalStripProps) {
  const avgCarbTarget = carbTargetG ? Math.round((carbTargetG[0] + carbTargetG[1]) / 2) : 250;
  const carbPercent = carbLoggedG != null && avgCarbTarget > 0 ? Math.min(100, Math.round((carbLoggedG / avgCarbTarget) * 100)) : 0;

  return (
    <SlideUp active={active} delayMs={140} style={{ marginTop: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 9 }}>
        {/* 1. Prontezza */}
        <Link href="/body" style={{ textDecoration: "none", color: "inherit" }}>
          <motion.div
            whileTap={{ scale: 0.96 }}
            style={{
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              borderRadius: "var(--radius-card)",
              padding: "12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--inchiostro-50)" }}>Prontezza</span>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background:
                    readinessScore == null
                      ? "var(--inchiostro-30)"
                      : readinessScore >= 70
                        ? "var(--verde)"
                        : readinessScore >= 45
                          ? "var(--giallo)"
                          : "var(--corallo)",
                }}
              />
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginTop: 2 }}>
              <span className="font-mono" style={{ fontSize: 19, fontWeight: 600, color: "var(--inchiostro)" }}>
                {readinessScore ?? "—"}
              </span>
              <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>/100</span>
            </div>
          </motion.div>
        </Link>

        {/* 2. Sonno */}
        <Link href="/body" style={{ textDecoration: "none", color: "inherit" }}>
          <motion.div
            whileTap={{ scale: 0.96 }}
            style={{
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              borderRadius: "var(--radius-card)",
              padding: "12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--inchiostro-50)" }}>Sonno</span>
              <span style={{ fontSize: 11 }}>💤</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginTop: 2 }}>
              <span className="font-mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--inchiostro)" }}>
                {sleepMinutes != null ? (
                  <>
                    {Math.floor(sleepMinutes / 60)}h{String(sleepMinutes % 60).padStart(2, "0")}
                  </>
                ) : (
                  "—"
                )}
              </span>
            </div>
          </motion.div>
        </Link>

        {/* 3. Carbo / Carburante */}
        <Link href="/body/fuel" style={{ textDecoration: "none", color: "inherit" }}>
          <motion.div
            whileTap={{ scale: 0.96 }}
            style={{
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              borderRadius: "var(--radius-card)",
              padding: "12px 10px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: "var(--inchiostro-50)" }}>Carbo</span>
              <span style={{ fontSize: 10, fontWeight: 600, color: "var(--corallo)" }}>{carbPercent}%</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 2, marginTop: 2 }}>
              <span className="font-mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--inchiostro)" }}>
                {carbLoggedG ?? 0}
              </span>
              <span className="font-mono" style={{ fontSize: 10.5, color: "var(--inchiostro-50)" }}>/{avgCarbTarget}g</span>
            </div>
          </motion.div>
        </Link>
      </div>
    </SlideUp>
  );
}
