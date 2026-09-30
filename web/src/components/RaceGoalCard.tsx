"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { SlideUp } from "@/components/motion/primitives";
import { TiltCard } from "@/components/motion/TiltCard";
import { Illustration } from "@/components/Illustration";
import { countdownLabel, distanceLabel, formatPaceSecPerKm, formatTargetTime, goalTitle, targetPaceSecPerKm } from "@/lib/raceGoal";
import { formatFullDate } from "@/lib/format";
import type { RaceGoal } from "@/lib/types";

/** The race the plan is written for, on Oggi.
 *
 * Without a goal it becomes an invitation to name one -- but only when there is
 * training ahead to name it *for*. An empty calendar has nothing to be an objective of,
 * and asking then is nagging; a plan with nine weeks of sessions in it and no race is a
 * question the app can genuinely answer once, so it asks once, here.
 */
export function RaceGoalCard({
  goal,
  upcomingSessions = 0,
  animate,
  delayMs = 0,
}: {
  goal: RaceGoal | null | undefined;
  /** Sessions still to come. Zero means: say nothing. */
  upcomingSessions?: number;
  animate: boolean;
  delayMs?: number;
}) {
  if (!goal) return upcomingSessions > 0 ? <MissingGoalCard sessions={upcomingSessions} animate={animate} delayMs={delayMs} /> : null;

  const pace = targetPaceSecPerKm(goal);
  const past = goal.phase === "gara passata";

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 14 }}>
      <Link href="/settings/goal" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        <TiltCard
          maxTilt={4}
          style={{
            background: "var(--sabbia)",
            border: "var(--border-airbnb)",
            boxShadow: "var(--shadow-airbnb-subtle)",
            borderRadius: "var(--radius-card)",
            padding: "16px 18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
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
            </div>
            <div style={{ flexShrink: 0, marginLeft: 8 }}>
              <Illustration name="obiettivo" size={48} />
            </div>
          </div>
        </TiltCard>
      </Link>
    </SlideUp>
  );
}

/** "Per che gara?" -- the one prompt, shown when sessions exist and a race doesn't.
 *
 * It promises exactly what the app then does: the sessions already in the calendar are
 * read against the race, not replaced by it. Nothing here writes anything; the whole
 * card is a link to the screen where the date gets typed.
 */
function MissingGoalCard({ sessions, animate, delayMs }: { sessions: number; animate: boolean; delayMs: number }) {
  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 14 }}>
      <Link href="/settings/goal" style={{ display: "block", textDecoration: "none", color: "inherit" }}>
        <motion.div
          whileHover={{ y: -2.5, scale: 1.012 }}
          whileTap={{ scale: 0.985 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          style={{
            background: "var(--sabbia)",
            border: "1.5px dashed var(--inchiostro-35)",
            borderRadius: "var(--radius-card)",
            padding: "16px 18px",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
                manca l&apos;obiettivo
              </span>

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 7 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ font: "600 17px/1.2 var(--font-outfit)", letterSpacing: "-.01em", margin: 0 }}>Per che gara ti alleni?</p>
                  <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.35 }}>
                    Hai <span className="font-mono" style={{ fontSize: 13.5, fontStyle: "normal" }}>{sessions}</span>{" "}
                    {sessions === 1 ? "seduta" : "sedute"} davanti. Dimmi la gara e rileggo quelle che hai già, per capire se ti ci portano.
                  </p>
                </div>
              </div>
            </div>
            <div style={{ flexShrink: 0, marginLeft: 8 }}>
              <Illustration name="obiettivo" size={48} />
            </div>
          </div>
        </motion.div>
      </Link>
    </SlideUp>
  );
}
