"use client";

import Image from "next/image";
import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { sessionDistanceKm } from "@/lib/sessionVisuals";
import { formatPaceValue, groupDistanceKm, groupSteps, sessionFallbackPaceSecPerKm, stepGroupParts } from "@/lib/format";
import type { StravaActivityMatch, TrainingSession } from "@/lib/types";

function getSessionIllustration(session: TrainingSession, hasInterval: boolean): string {
  const sport = session.sport?.toLowerCase();
  if (sport === "cycling" || sport === "bici") return "/illustrazioni/bici.webp";
  if (sport === "strength_training" || sport === "forza") return "/illustrazioni/forza.webp";
  if (sport === "other" || sport === "riposo") return "/illustrazioni/riposo.webp";
  if (hasInterval) return "/illustrazioni/fiamma.webp";
  return "/illustrazioni/corsa.webp";
}

function StepKindIcon({ kind }: { kind: string }) {
  if (kind === "interval") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
      </svg>
    );
  }
  if (kind === "warmup") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    );
  }
  if (kind === "cooldown") {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.59 4.59A2 2 0 1 1 11 8H2m10.59 11.41A2 2 0 1 0 14 16H2m15.73-8.27A2.5 2.5 0 1 1 19.5 12H2" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

/** The shared "what is this workout" view -- hero summary card, structured steps,
 * and (when matched) Strava comparison link. Renders instantly with no stuttering animations. */
export function SessionDetailBody({
  session,
  hasStravaMatch,
  matchData,
  stravaHref,
}: {
  session: TrainingSession;
  animate?: boolean;
  hasStravaMatch: boolean;
  matchData: StravaActivityMatch | undefined;
  stravaHref: string;
}) {
  const steps = session.steps ?? [];
  const distanceKm = sessionDistanceKm(session);
  const groups = groupSteps(steps);
  const fallbackPace = sessionFallbackPaceSecPerKm(steps);
  const hasInterval = groups.some((g) => g.kind === "interval");
  const illustrationSrc = getSessionIllustration(session, hasInterval);

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", marginTop: 12 }}>
      {/* Title */}
      <SlideUp delayMs={0}>
        <h1
          style={{
            fontSize: 26,
            fontWeight: 700,
            color: "var(--inchiostro)",
            textAlign: "center",
            margin: "12px 0 6px",
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
          }}
        >
          {session.title}
        </h1>

        {/* Description */}
        {session.description && (
          <p
            style={{
              fontSize: 14,
              textAlign: "center",
              color: "var(--inchiostro-70)",
              margin: "0 auto 20px",
              maxWidth: 320,
              lineHeight: 1.45,
            }}
          >
            {session.description}
          </p>
        )}
      </SlideUp>

      {/* Hero Stat Card (Airbnb Style) */}
      <SlideUp delayMs={50}>
        <div
          style={{
            background: "var(--crema-card)",
            border: "1px solid var(--border-airbnb)",
            borderRadius: 24,
            padding: "20px 22px",
            boxShadow: "var(--shadow-airbnb)",
            marginTop: session.description ? 0 : 12,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span
                  style={{
                    background: "var(--sabbia-chip)",
                    border: "1px solid var(--border-airbnb)",
                    borderRadius: "var(--radius-pill)",
                    padding: "4px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    color: "var(--inchiostro)",
                  }}
                >
                  {session.sport === "cycling" ? "Bici" : session.sport === "strength_training" ? "Forza" : "Corsa"}
                </span>
                {groups.length > 0 && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--inchiostro-50)",
                    }}
                  >
                    {groups.length} {groups.length === 1 ? "fase" : "fasi"}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span
                  className="font-mono"
                  style={{
                    fontSize: 42,
                    fontWeight: 700,
                    color: "var(--inchiostro)",
                    letterSpacing: "-0.03em",
                    lineHeight: 1,
                  }}
                >
                  {distanceKm > 0 ? distanceKm.toFixed(1) : "—"}
                </span>
                <span style={{ fontSize: 18, fontWeight: 600, color: "var(--inchiostro-50)" }}>km</span>
              </div>

              <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "4px 0 0", fontWeight: 500 }}>
                Distanza programmata
              </p>
            </div>

            {/* 3D Illustration - static, clean Airbnb look */}
            <div
              style={{
                width: 76,
                height: 76,
                position: "relative",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Image
                src={illustrationSrc}
                alt="Illustrazione allenamento"
                width={76}
                height={76}
                style={{ objectFit: "contain" }}
                priority
              />
            </div>
          </div>

          {/* Metric Badges Strip */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 18,
              paddingTop: 16,
              borderTop: "1px solid var(--border-airbnb)",
            }}
          >
            <div style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--inchiostro-50)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Passo target
              </span>
              <span className="font-mono" style={{ display: "block", fontSize: 15, fontWeight: 600, color: "var(--inchiostro)", marginTop: 2 }}>
                {fallbackPace ? `${formatPaceValue(fallbackPace)}/km` : "Libero"}
              </span>
            </div>

            <div style={{ width: 1, height: 26, background: "var(--border-airbnb)" }} />

            <div style={{ flex: 1 }}>
              <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--inchiostro-50)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Intensità
              </span>
              <span
                style={{
                  display: "inline-block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: hasInterval ? "var(--corallo-testo)" : "var(--verde-testo)",
                  background: hasInterval ? "var(--corallo)" : "var(--verde)",
                  padding: "2px 8px",
                  borderRadius: "var(--radius-pill)",
                  marginTop: 3,
                }}
              >
                {hasInterval ? "Ripetute" : "Costante"}
              </span>
            </div>
          </div>
        </div>
      </SlideUp>

      {/* Structured Steps Section */}
      <SlideUp delayMs={100} style={{ marginTop: 28 }}>
        <h2
          style={{
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--inchiostro-50)",
            margin: "0 0 12px 2px",
          }}
        >
          Struttura dell&apos;allenamento
        </h2>

        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
          {groups.length === 0 && (
            <div
              style={{
                background: "var(--crema-card)",
                border: "1px solid var(--border-airbnb)",
                borderRadius: 16,
                padding: "20px 16px",
                textAlign: "center",
                color: "var(--inchiostro-50)",
                fontSize: 13,
              }}
            >
              Sessione continua a ritmo costante, senza step strutturati.
            </div>
          )}

          {groups.map((group, i) => {
            const isKey = group.kind === "interval";
            const { label, detail } = stepGroupParts(group);
            const km = groupDistanceKm(group, fallbackPace);

            return (
              <SlideUp key={i} delayMs={110 + i * 25} row>
                <div
                  style={{
                    background: isKey ? "linear-gradient(135deg, #FF6F61 0%, #E85D4E 100%)" : "var(--crema-card)",
                    color: isKey ? "#FFFFFF" : "var(--inchiostro)",
                    border: isKey ? "none" : "1px solid var(--border-airbnb)",
                    borderRadius: 18,
                    padding: "14px 18px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    boxShadow: isKey ? "0 4px 14px rgba(232, 93, 78, 0.2)" : "0 1px 3px rgba(0,0,0,0.02)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        background: isKey ? "rgba(255, 255, 255, 0.2)" : "var(--sabbia-chip)",
                        color: isKey ? "#FFFFFF" : "var(--inchiostro)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <StepKindIcon kind={group.kind} />
                    </div>

                    <div>
                      <span style={{ display: "block", fontSize: 14, fontWeight: 600, lineHeight: 1.2 }}>{label}</span>
                      {detail && (
                        <span
                          className="font-mono"
                          style={{
                            display: "block",
                            fontSize: 11.5,
                            opacity: isKey ? 0.9 : 0.65,
                            marginTop: 3,
                          }}
                        >
                          {detail}
                        </span>
                      )}
                    </div>
                  </div>

                  {km > 0 && (
                    <span
                      className="font-mono"
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        flex: "none",
                        background: isKey ? "rgba(255, 255, 255, 0.2)" : "var(--sabbia-chip)",
                        borderRadius: "var(--radius-pill)",
                        padding: "4px 10px",
                      }}
                    >
                      {km.toFixed(1).replace(".", ",")} km
                    </span>
                  )}
                </div>
              </SlideUp>
            );
          })}
        </div>
      </SlideUp>

      {/* Strava Match Card */}
      {hasStravaMatch && matchData && (
        <SlideUp delayMs={150}>
          <Link href={stravaHref} style={{ textDecoration: "none", color: "inherit", width: "100%", marginTop: 22, display: "block" }}>
          <div
            style={{
              width: "100%",
              boxSizing: "border-box",
              background: "var(--crema-card)",
              border: "1px solid var(--border-airbnb)",
              borderRadius: 20,
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              boxShadow: "var(--shadow-airbnb-subtle)",
              transition: "transform 0.15s ease",
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "#FC5200",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#FFFFFF",
                flexShrink: 0,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7.925 15.6h4.172" />
              </svg>
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700, margin: 0, color: "var(--inchiostro)" }}>
                  Attività registrata su Strava
                </p>
              </div>
              <p className="font-mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--inchiostro)", margin: "3px 0 0" }}>
                {matchData.distance_km != null ? `${matchData.distance_km.toFixed(1)} km` : "—"}
                {matchData.avg_pace_sec_per_km != null && ` · ${formatPaceValue(matchData.avg_pace_sec_per_km)}/km`}
              </p>
              <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "3px 0 0" }}>
                Tocca per confrontare pianificato e svolto
              </p>
            </div>

            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "var(--sabbia-chip)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--inchiostro-50)",
                flexShrink: 0,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </div>
          </div>
        </Link>
        </SlideUp>
      )}
    </div>
  );
}
