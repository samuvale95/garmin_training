"use client";

import Link from "next/link";
import { ProgressRing, WordIn } from "@/components/motion/primitives";
import { sessionDistanceKm } from "@/lib/sessionVisuals";
import { formatPaceValue, groupSteps, stepDistanceKm, stepGroupParts } from "@/lib/format";
import type { StravaActivityMatch, TrainingSession } from "@/lib/types";

/** The shared "what is this workout" view -- distance ring, title, description, and
 * structured steps, plus (when matched) a collapsed Strava summary linking to the
 * full comparison. Used identically by `session/[id]` (an imported plan's session)
 * and `workout/[id]` (a live Garmin-calendar workout with no local plan behind it,
 * whose steps now come straight from Garmin -- see `useWorkoutSession`), so both
 * routes render the same detail page rather than the live-workout one being a
 * thinner, Strava-only stand-in. */
export function SessionDetailBody({
  session,
  animate,
  hasStravaMatch,
  matchData,
  stravaHref,
}: {
  session: TrainingSession;
  animate: boolean;
  hasStravaMatch: boolean;
  matchData: StravaActivityMatch | undefined;
  stravaHref: string;
}) {
  const steps = session.steps ?? []; // guards a stale localStorage plan saved before `steps` existed
  const distanceKm = sessionDistanceKm(session);
  const groups = groupSteps(steps);

  return (
    <>
      <ProgressRing value={Math.min(1, distanceKm / 20)} size={180} strokeWidth={12} trackColor="rgba(246,238,218,.13)">
        <div style={{ textAlign: "center" }}>
          <p className="font-mono" style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>{distanceKm.toFixed(1)}</p>
          <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: 0 }}>km totali</p>
        </div>
      </ProgressRing>

      <WordIn active={animate} delayMs={200} style={{ font: "600 26px/1.06 var(--font-outfit)", textAlign: "center", marginTop: 20 }}>
        {session.title}
      </WordIn>
      {session.description && (
        <p className="font-serif-italic" style={{ fontSize: 15.5, textAlign: "center", color: "var(--inchiostro-su-scuro)", maxWidth: 280 }}>
          {session.description}
        </p>
      )}

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        {groups.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--inchiostro-su-scuro)", fontSize: 13 }}>Sessione libera, senza step strutturati.</p>
        )}
        {groups.map((group, i) => {
          const isKey = group.kind === "interval";
          const { label, detail } = stepGroupParts(group);
          const km = group.reps * stepDistanceKm(group.step) + (group.recovery ? group.reps * stepDistanceKm(group.recovery) : 0);
          return (
            <div
              key={i}
              style={{
                background: isKey ? "var(--corallo)" : "rgba(246,238,218,.07)",
                color: isKey ? "var(--corallo-testo)" : "var(--crema)",
                borderRadius: "var(--radius-row)",
                padding: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
              className={isKey ? "anim-breath" : undefined}
            >
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</span>
                {detail && (
                  <span className="font-mono" style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>{detail}</span>
                )}
              </span>
              {km > 0 && (
                <span className="font-mono" style={{ fontSize: 12, flex: "none" }}>{km.toFixed(1).replace(".", ",")} km</span>
              )}
            </div>
          );
        })}
      </div>

      {hasStravaMatch && matchData && (
        <Link href={stravaHref} style={{ textDecoration: "none", color: "inherit", width: "100%" }}>
          <div style={{ width: "100%", boxSizing: "border-box", background: "rgba(246,238,218,.09)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Svolta, da Strava</p>
              <p className="font-mono" style={{ fontSize: 13, margin: "3px 0 0" }}>
                {matchData.distance_km != null ? `${matchData.distance_km.toFixed(1)} km` : "—"}
                {matchData.avg_pace_sec_per_km != null && ` · ${formatPaceValue(matchData.avg_pace_sec_per_km)}`}
              </p>
              <p className="font-serif-italic" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)", margin: "3px 0 0" }}>
                Confronta pianificato e svolto
              </p>
            </div>
            <span aria-hidden="true">›</span>
          </div>
        </Link>
      )}
    </>
  );
}
