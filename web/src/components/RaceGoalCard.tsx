"use client";

import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { countdownLabel, distanceLabel, formatPaceSecPerKm, formatTargetTime, goalTitle, targetPaceSecPerKm } from "@/lib/raceGoal";
import { formatFullDate } from "@/lib/format";
import type { RaceGoal } from "@/lib/types";

/** The race the plan is written for, on Oggi.
 *
 * Renders nothing at all without a goal -- no empty state, no nagging to set one. A
 * plan with no race is a normal plan, and this card is the only thing in the app that
 * would have an opinion about that.
 */
export function RaceGoalCard({ goal, animate, delayMs = 0 }: { goal: RaceGoal | null | undefined; animate: boolean; delayMs?: number }) {
  if (!goal) return null;

  const pace = targetPaceSecPerKm(goal);
  const past = goal.phase === "gara passata";

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 14 }}>
      <Link
        href="/settings/goal"
        className="press-soft"
        style={{
          display: "block",
          background: "var(--sabbia)",
          borderRadius: "var(--radius-card)",
          padding: "15px 18px",
          textDecoration: "none",
          color: "inherit",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
            {past ? "gara corsa" : "obiettivo"}
          </span>
          {goal.phase && !past && (
            <span style={{ background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
              {goal.phase}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 7 }}>
          <p style={{ font: "600 17px/1.2 var(--font-outfit)", letterSpacing: "-.01em", margin: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {goalTitle(goal)}
          </p>
          <span className="font-mono" style={{ fontSize: 12.5, color: "var(--inchiostro-70)", flex: "none" }}>
            {countdownLabel(goal)}
          </span>
        </div>

        <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>
          {formatFullDate(goal.race_date)} · {distanceLabel(goal.distance_km)}
          {goal.target_time_seconds != null && ` · ${formatTargetTime(goal.target_time_seconds)}`}
          {pace != null && ` (${formatPaceSecPerKm(pace)}/km)`}
        </p>
      </Link>
    </SlideUp>
  );
}
