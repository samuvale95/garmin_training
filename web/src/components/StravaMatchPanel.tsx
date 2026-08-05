"use client";

import Link from "next/link";
import { formatPaceValue } from "@/lib/format";
import type { StravaActivityMatch } from "@/lib/types";

/** The "svolto" (and, when there's a plan to compare against, "pianificato") panel
 * for a matched Strava activity -- shared by `session/[id]/strava` (a planned session)
 * and `workout/[id]` (a live Garmin-calendar workout with no plan behind it, where
 * `showPlanned` is false and the planned-only fields don't render). */
export function StravaMatchPanel({
  match,
  isLoading,
  showPlanned,
  shoesFrom,
}: {
  match: StravaActivityMatch | undefined;
  isLoading: boolean;
  showPlanned: boolean;
  shoesFrom: string;
}) {
  if (!match || !match.matched) {
    return (
      <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-su-scuro)", marginTop: 20 }}>
        {isLoading ? "Cerco l'attività su Strava..." : "Nessuna attività Strava corrispondente trovata per questa data."}
      </p>
    );
  }

  return (
    <>
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        {showPlanned && (
          <div style={{ flex: 1, background: "rgba(246,238,218,.08)", borderRadius: "var(--radius-card)", padding: 14 }}>
            <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: "0 0 6px" }}>pianificato</p>
            <p className="font-mono" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
              {match.planned_distance_km != null ? match.planned_distance_km.toFixed(1) : "—"} km
            </p>
            <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: "4px 0 0" }}>
              {match.planned_pace_sec_per_km != null ? `${formatPaceValue(match.planned_pace_sec_per_km)} target` : "nessun passo target"}
            </p>
          </div>
        )}
        <div style={{ flex: 1, background: "var(--corallo)", color: "var(--corallo-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
          <p style={{ fontSize: 11, opacity: 0.75, margin: "0 0 6px" }}>svolto</p>
          <p className="font-mono" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
            {match.distance_km != null ? match.distance_km.toFixed(1) : "—"} km
          </p>
          <p style={{ fontSize: 11, margin: "4px 0 0" }}>
            {match.avg_pace_sec_per_km != null ? `${formatPaceValue(match.avg_pace_sec_per_km)} medio` : "—"}
          </p>
        </div>
      </div>

      <StravaRow label="Frequenza cardiaca">
        {match.average_heartrate != null ? `media ${Math.round(match.average_heartrate)} bpm` : "—"}
        {match.max_heartrate != null && ` · picco ${Math.round(match.max_heartrate)} bpm`}
      </StravaRow>

      <StravaRow label="Dislivello">
        {match.elevation_gain_m != null ? `+${Math.round(match.elevation_gain_m)} m` : "—"}
        {showPlanned ? " · nessuno pianificato" : ""}
      </StravaRow>

      {match.felt_note && (
        <StravaRow label="Sensazione">&quot;{match.felt_note}&quot; · nota da Strava</StravaRow>
      )}

      <Link href={`/shoes?from=${encodeURIComponent(shoesFrom)}`} style={{ textDecoration: "none", color: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(246,238,218,.07)", borderRadius: "var(--radius-row)", padding: 14, marginTop: 10 }}>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Scarpe</span>
            <span className="font-mono" style={{ display: "block", fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>
              {match.gear_name ?? "—"}
            </span>
          </span>
          <span aria-hidden="true">›</span>
        </div>
      </Link>

      {showPlanned && match.plan_note && (
        <div style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 16 }}>
          <p style={{ fontWeight: 600, margin: "0 0 6px", fontSize: 14 }}>Cosa cambia nel piano</p>
          <p className="font-serif-italic" style={{ fontSize: 13.5, margin: 0 }}>{match.plan_note}</p>
        </div>
      )}
    </>
  );
}

function StravaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(246,238,218,.07)", borderRadius: "var(--radius-row)", padding: 14, marginTop: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>{label}</p>
      <p className="font-mono" style={{ fontSize: 12, opacity: 0.85, margin: 0 }}>{children}</p>
    </div>
  );
}
