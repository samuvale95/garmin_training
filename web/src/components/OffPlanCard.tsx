"use client";

import type { StoredActivity } from "@/lib/types";

const SOURCE_LABELS: Record<StoredActivity["source"], string> = {
  garmin: "misurate",
  strava: "da Strava",
  stima: "stimate",
};

/** A workout done outside the plan -- a ride, a swim, tennis -- in its day on Settimana.
 * Not draggable and not editable: it already happened. It is here so the calendar
 * describes the week that took place, not only the one that was planned. */
export function OffPlanCard({ activity }: { activity: StoredActivity; animate?: boolean; delayMs?: number }) {
  const details = [
    `${Math.round(activity.minutes)} min`,
    activity.distance_km ? `${activity.distance_km.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km` : null,
    `${activity.kcal} kcal ${SOURCE_LABELS[activity.source]}`,
  ].filter(Boolean);
  return (
    <div className="session-card" data-offplan style={{ "--sport": "var(--line-strong)" } as React.CSSProperties}>
      <span className="session-card-body">
        <span className="session-card-top">
          <span className="badge" data-tone="ok">Svolto fuori piano</span>
          <span className="sport-tag" style={{ color: "var(--ink-2)" }}>{activity.label}</span>
        </span>
        <span className="session-card-title">{activity.title || activity.label}</span>
        <span className="session-card-meta">{details.join(" · ")}</span>
      </span>
    </div>
  );
}

/** A planned session's sport as the server's sport family, so a planned run and a Garmin
 * `running` activity count as the same workout. Mirrors `history.sport_family` for the
 * sports a plan uses. */
export function planFamily(sport: string | null | undefined): string {
  const s = (sport ?? "").toLowerCase();
  if (s.includes("run")) return "run";
  if (s.includes("cycl") || s.includes("bik") || s.includes("ride")) return "ride";
  if (s.includes("swim")) return "swim";
  if (s.includes("strength") || s.includes("weight")) return "strength";
  if (s.includes("walk")) return "walk";
  if (s.includes("hik")) return "hike";
  return s;
}

/** The day's activities that are not a planned session: each planned session of a sport
 * family takes one activity of that family; everything left is outside the plan. */
export function offPlanActivities(activities: StoredActivity[], plannedSports: (string | null | undefined)[]): StoredActivity[] {
  const slots = new Map<string, number>();
  for (const sport of plannedSports) {
    const family = planFamily(sport);
    slots.set(family, (slots.get(family) ?? 0) + 1);
  }
  return activities.filter((activity) => {
    const left = slots.get(activity.family) ?? 0;
    if (left > 0) {
      slots.set(activity.family, left - 1);
      return false;
    }
    return true;
  });
}
