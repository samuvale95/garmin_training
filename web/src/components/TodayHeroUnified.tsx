"use client";

import Link from "next/link";
import { ArrowUpRight, CheckIcon } from "@/components/Icons";
import { Illustration } from "@/components/Illustration";
import { TiltCard } from "@/components/motion/TiltCard";
import { SlideUp, StatusDot } from "@/components/motion/primitives";
import { capitalize, formatFullDate, relativeDayLabel, stepGroupLine, type StepGroup } from "@/lib/format";
import { classifySession, type DisplaySession } from "@/lib/sessionVisuals";
import type { DayVerdict } from "@/lib/types";

interface TodayHeroUnifiedProps {
  heroSession: DisplaySession | null;
  heroMainGroup: StepGroup | null;
  heroMatch?: { matched: boolean; distance_km?: number | null };
  heroHref: string;
  verdict?: DayVerdict | null;
  today: Date;
  animate: boolean;
}

const STATE_BADGE: Record<string, { label: string; bg: string; color: string; dot: "active" | "queued" | "in_progress" }> = {
  pronto: { label: "Pronto", bg: "rgba(16, 185, 129, 0.12)", color: "var(--verde-tratto-scuro)", dot: "active" },
  cauto: { label: "Cauto", bg: "rgba(245, 158, 11, 0.14)", color: "var(--giallo-testo)", dot: "queued" },
  scarico: { label: "Scarico", bg: "rgba(239, 68, 68, 0.14)", color: "var(--corallo-testo)", dot: "in_progress" },
};

export function TodayHeroUnified({
  heroSession,
  heroMainGroup,
  heroMatch,
  heroHref,
  verdict,
  today,
  animate,
}: TodayHeroUnifiedProps) {
  const isWorkout = !!heroSession;
  const badge = verdict ? STATE_BADGE[verdict.state] ?? null : null;

  return (
    <SlideUp active={animate} delayMs={100}>
      <TiltCard
        maxTilt={4}
        className="today-hero"
        style={{
          background: "var(--crema-card)",
          border: isWorkout ? "1.5px solid rgba(255, 111, 89, 0.25)" : "var(--border-airbnb)",
          boxShadow: "var(--shadow-airbnb-subtle)",
          color: "var(--inchiostro)",
          borderRadius: "var(--radius-card-lg)",
          padding: "20px 20px 18px",
          marginTop: 16,
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          minHeight: 200,
        }}
      >
        {/* Top bar: Subtitle date on left, Readiness/Verdict badge on right */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
          <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: 0, letterSpacing: ".02em" }}>
            {heroSession ? `${relativeDayLabel(heroSession.date, today)} · ${formatFullDate(heroSession.date)}` : "Oggi"}
          </p>

          {badge && (
            <Link href="/body/stato" style={{ textDecoration: "none" }}>
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  background: badge.bg,
                  color: badge.color,
                  borderRadius: "var(--radius-pill)",
                  padding: "3px 9px",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                <StatusDot kind={badge.dot} size={6} />
                <span>{badge.label}</span>
              </div>
            </Link>
          )}
        </div>

        {/* Center: Title + Workout Steps vs Illustration */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {heroSession ? (
              <>
                <h2 style={{ font: "600 23px/1.16 var(--font-sans)", letterSpacing: "-.025em", margin: "0 0 6px", color: "var(--inchiostro)" }}>
                  {heroSession.title}
                </h2>
                {heroMainGroup && (
                  <p className="font-mono" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.35 }}>
                    {stepGroupLine(heroMainGroup)}
                  </p>
                )}
                {heroMatch?.matched && heroMatch.distance_km != null && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, background: "var(--sabbia)", padding: "3px 8px", borderRadius: 8 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 11, color: "var(--verde-tratto-scuro)", fontWeight: 600 }}>
                      <CheckIcon size={12} strokeWidth={2.8} /> Strava
                    </span>
                    <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-70)" }}>
                      {heroMatch.distance_km.toFixed(1)} km svolti
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div>
                <h2 style={{ font: "600 22px/1.2 var(--font-sans)", letterSpacing: "-.02em", margin: "0 0 6px", color: "var(--inchiostro)" }}>
                  Giorno di riposo
                </h2>
                <p style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.4 }}>
                  Nessuna corsa in programma. Il corpo assorbe il carico e rigenera le fibre.
                </p>
              </div>
            )}
          </div>

          <div style={{ width: 88, height: 96, position: "relative", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Illustration
              name={heroSession ? classifySession(heroSession).illustration ?? "corsa" : "riposo"}
              width={88}
              height={96}
              position="relative"
              active={animate}
              delayMs={160}
              breathe
              float
            />
          </div>
        </div>

        {/* Bottom Action Row */}
        <Link
          href={heroHref}
          className="tap-target"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 6,
            marginTop: 18,
            paddingTop: 12,
            borderTop: "1px solid var(--sabbia)",
            color: "var(--inchiostro)",
            textDecoration: "none",
            fontWeight: 600,
            fontSize: 13.5,
          }}
        >
          <span>{heroSession ? "Vedi dettagli allenamento" : "Esplora la settimana"}</span>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "var(--sabbia)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--inchiostro)",
            }}
          >
            <ArrowUpRight size={14} />
          </span>
        </Link>
      </TiltCard>
    </SlideUp>
  );
}
