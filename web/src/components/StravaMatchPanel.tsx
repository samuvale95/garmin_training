"use client";

import Link from "next/link";
import { formatPaceValue } from "@/lib/format";
import type { StravaActivityMatch } from "@/lib/types";

/** The "svolto" and "pianificato" panel for a matched Strava activity -- rendered by
 * `StravaComparisonScreen` for both an imported plan's session and a live
 * Garmin-calendar workout (whose "pianificato" side comes from Garmin's own copy of the
 * workout via `useWorkoutSession`). Both have a planned side, which is why the old
 * `showPlanned` switch is gone: every caller passed `true`. */
export function StravaMatchPanel({
  match,
  isLoading,
  shoesFrom,
}: {
  match: StravaActivityMatch | undefined;
  isLoading: boolean;
  shoesFrom: string;
}) {
  if (!match || !match.matched) {
    return (
      <p style={{ fontSize: 14, color: "var(--inchiostro-50)", marginTop: 20, textAlign: "center" }}>
        {isLoading ? "Cerco l'attività su Strava..." : "Nessuna attività Strava corrispondente trovata per questa data."}
      </p>
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
        <div
          style={{
            flex: 1,
            background: "var(--crema-card)",
            border: "1px solid var(--border-airbnb)",
            borderRadius: 20,
            padding: 16,
            boxShadow: "var(--shadow-airbnb-subtle)",
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--inchiostro-50)", margin: "0 0 6px" }}>
            Pianificato
          </p>
          <p className="font-mono" style={{ fontSize: 24, fontWeight: 700, color: "var(--inchiostro)", margin: 0 }}>
            {match.planned_distance_km != null ? match.planned_distance_km.toFixed(1) : "—"}{" "}
            <span style={{ fontSize: 14, fontWeight: 500, color: "var(--inchiostro-50)" }}>km</span>
          </p>
          <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>
            {match.planned_pace_sec_per_km != null ? `${formatPaceValue(match.planned_pace_sec_per_km)}/km target` : "Passo libero"}
          </p>
        </div>

        <div
          style={{
            flex: 1,
            background: "linear-gradient(135deg, #FF6F61 0%, #E85D4E 100%)",
            color: "#FFFFFF",
            borderRadius: 20,
            padding: 16,
            boxShadow: "0 4px 14px rgba(232, 93, 78, 0.22)",
          }}
        >
          <p style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.85, margin: "0 0 6px" }}>
            Svolto
          </p>
          <p className="font-mono" style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>
            {match.distance_km != null ? match.distance_km.toFixed(1) : "—"}{" "}
            <span style={{ fontSize: 14, fontWeight: 500, opacity: 0.85 }}>km</span>
          </p>
          <p style={{ fontSize: 12, opacity: 0.9, margin: "4px 0 0" }}>
            {match.avg_pace_sec_per_km != null ? `${formatPaceValue(match.avg_pace_sec_per_km)}/km medio` : "—"}
          </p>
        </div>
      </div>

      <StravaRow label="Frequenza cardiaca">
        {match.average_heartrate != null ? `media ${Math.round(match.average_heartrate)} bpm` : "—"}
        {match.max_heartrate != null && ` · picco ${Math.round(match.max_heartrate)} bpm`}
      </StravaRow>

      <StravaRow label="Dislivello">
        {match.elevation_gain_m != null ? `+${Math.round(match.elevation_gain_m)} m` : "—"}
        {" · nessuno pianificato"}
      </StravaRow>

      {match.felt_note && (
        <StravaRow label="Sensazione">&quot;{match.felt_note}&quot; · nota da Strava</StravaRow>
      )}

      <Link data-track="strava-match-panel.shoes-from-encodeuricomponent-" href={`/shoes?from=${encodeURIComponent(shoesFrom)}`} style={{ textDecoration: "none", color: "inherit" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--crema-card)",
            border: "1px solid var(--border-airbnb)",
            borderRadius: 18,
            padding: "14px 18px",
            marginTop: 10,
            boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
          }}
        >
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "var(--inchiostro)" }}>Scarpe</span>
            <span className="font-mono" style={{ display: "block", fontSize: 12, color: "var(--inchiostro-50)", marginTop: 2 }}>
              {match.gear_name ?? "Nessuna scarpa registrata"}
            </span>
          </span>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              background: "var(--sabbia-chip)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--inchiostro-50)",
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </div>
        </div>
      </Link>

      {match.plan_note && (
        <div
          style={{
            background: "var(--azzurro)",
            color: "var(--azzurro-testo)",
            border: "1px solid rgba(74, 144, 226, 0.2)",
            borderRadius: 18,
            padding: "16px 18px",
            marginTop: 16,
          }}
        >
          <p style={{ fontWeight: 700, margin: "0 0 4px", fontSize: 14 }}>Cosa cambia nel piano</p>
          <p style={{ fontSize: 13.5, margin: 0, lineHeight: 1.45 }}>{match.plan_note}</p>
        </div>
      )}
    </>
  );
}

function StravaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--crema-card)",
        border: "1px solid var(--border-airbnb)",
        borderRadius: 18,
        padding: "14px 18px",
        marginTop: 10,
        boxShadow: "0 1px 3px rgba(0,0,0,0.02)",
      }}
    >
      <p style={{ fontSize: 11.5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--inchiostro-50)", margin: "0 0 4px" }}>
        {label}
      </p>
      <p className="font-mono" style={{ fontSize: 13.5, fontWeight: 500, color: "var(--inchiostro)", margin: 0 }}>
        {children}
      </p>
    </div>
  );
}
