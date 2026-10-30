"use client";

import Link from "next/link";
import { ContextLink } from "@/components/ContextLink";
import { ArrowUpRight, CheckIcon } from "@/components/Icons";
import { Illustration } from "@/components/Illustration";
import { TiltCard } from "@/components/motion/TiltCard";
import { SlideUp, StatusDot } from "@/components/motion/primitives";
import { formatFullDate, relativeDayLabel, stepGroupLine, type StepGroup } from "@/lib/format";
import { classifySession, effectiveSteps, effectiveTitle, sessionDurationMinutes, type DisplaySession } from "@/lib/sessionVisuals";
import { useToggleSessionShort } from "@/lib/queries";
import type { DayVerdict } from "@/lib/types";

interface TodayHeroUnifiedProps {
  heroSession: DisplaySession | null;
  heroMainGroup: StepGroup | null;
  heroMatch?: { matched: boolean; distance_km?: number | null };
  heroHref: string;
  verdict?: DayVerdict | null;
  today: Date;
  animate: boolean;
  todaySessions?: DisplaySession[];
  selectedSessionIndex?: number;
  onSelectSessionIndex?: (idx: number) => void;
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
  todaySessions,
  selectedSessionIndex = 0,
  onSelectSessionIndex,
}: TodayHeroUnifiedProps) {
  const isWorkout = !!heroSession;
  const badge = verdict ? STATE_BADGE[verdict.state] ?? null : null;
  const toggleShort = useToggleSessionShort();
  const currentTitle = heroSession ? effectiveTitle(heroSession) : "";
  const isStrength = heroSession?.sport === "calisthenics" || heroSession?.sport === "strength_training";
  const durationMin = heroSession ? Math.round(sessionDurationMinutes(heroSession)) : 0;
  const hasMultipleSessions = todaySessions && todaySessions.length > 1;

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
          <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: 0, letterSpacing: ".02em" }}>
            {heroSession ? `${relativeDayLabel(heroSession.date, today)} · ${formatFullDate(heroSession.date)}` : "Oggi"}
          </p>

          {badge && (
            <Link data-track="today-hero-unified.body-stato" href="/body/stato" style={{ textDecoration: "none" }}>
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

        {/* Multi-session picker pills if user has 2+ sessions on today */}
        {hasMultipleSessions && onSelectSessionIndex && (
          <div style={{ display: "flex", gap: 6, marginBottom: 12, overflowX: "auto", paddingBottom: 2 }}>
            {todaySessions.map((s, idx) => {
              const active = idx === selectedSessionIndex;
              const sportLabel = s.sport === "cycling" ? "Bici" : s.sport === "calisthenics" ? "Calisthenics" : s.sport === "strength_training" ? "Forza" : "Corsa";
              return (
                <button
                  key={`${s.date}-${idx}`}
                  type="button"
                  onClick={() => onSelectSessionIndex(idx)}
                  className="press-soft"
                  style={{
                    fontSize: 11.5,
                    padding: "3px 9px",
                    borderRadius: "var(--radius-pill)",
                    border: active ? "1.5px solid var(--inchiostro)" : "1px solid var(--sabbia-bordo)",
                    background: active ? "var(--inchiostro)" : "var(--sabbia-chip)",
                    color: active ? "var(--crema)" : "var(--inchiostro-70)",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Seduta {idx + 1}: {sportLabel}
                </button>
              );
            })}
          </div>
        )}

        {/* Center: Title + Workout Steps vs Illustration */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {heroSession ? (
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: 10.5,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      background: "var(--sabbia-chip)",
                      color: "var(--inchiostro-70)",
                      padding: "2px 7px",
                      borderRadius: "var(--radius-pill)",
                    }}
                  >
                    {heroSession.sport === "cycling" ? "Bici" : heroSession.sport === "calisthenics" ? "Calisthenics" : heroSession.sport === "strength_training" ? "Forza" : "Corsa"}
                  </span>
                  {durationMin > 0 && (
                    <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
                      ~{durationMin} min
                    </span>
                  )}
                </div>

                <h2 style={{ font: "600 23px/1.16 var(--font-sans)", letterSpacing: "-.025em", margin: "0 0 6px", color: "var(--inchiostro)" }}>
                  {currentTitle}
                </h2>
                {heroMainGroup && (
                  <p className="font-mono" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.35 }}>
                    {stepGroupLine(heroMainGroup)}
                  </p>
                )}
                {heroSession.short_variant && (
                  <div style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    <div
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        background: heroSession.is_short_active ? "rgba(232, 93, 78, 0.15)" : "var(--sabbia)",
                        padding: "3px 8px",
                        borderRadius: "var(--radius-pill)",
                      }}
                    >
                      <span style={{ fontSize: 11, fontWeight: 700, color: heroSession.is_short_active ? "var(--corallo-testo)" : "var(--inchiostro-70)" }}>
                        {heroSession.is_short_active ? "⚡ Salva-tempo attiva" : "⚡ Poco tempo? Disponibile variante corta"}
                      </span>
                    </div>

                    {'id' in heroSession && typeof (heroSession as { id?: string }).id === "string" && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const sid = (heroSession as { id?: string }).id;
                          if (sid) toggleShort(sid);
                        }}
                        className="press-soft"
                        style={{
                          background: heroSession.is_short_active ? "var(--corallo)" : "var(--inchiostro)",
                          color: heroSession.is_short_active ? "var(--corallo-testo)" : "var(--crema)",
                          border: "none",
                          borderRadius: "var(--radius-pill)",
                          padding: "2px 8px",
                          fontSize: 10.5,
                          fontWeight: 700,
                          cursor: "pointer",
                        }}
                      >
                        {heroSession.is_short_active ? "Torna normale" : "Attiva subito"}
                      </button>
                    )}
                  </div>
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
                  Nessun allenamento in programma. Il corpo assorbe il carico e rigenera le fibre.
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
        <ContextLink from="/today" data-track="today-hero-unified.herohref"
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
        </ContextLink>
      </TiltCard>
    </SlideUp>
  );
}
