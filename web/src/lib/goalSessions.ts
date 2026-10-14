"use client";

import { useMemo } from "react";
import { GOAL_LOOKAHEAD_DAYS, useWorkouts } from "./queries";
import { shiftDateKey, workoutsToSessions } from "./sessionVisuals";
import type { RaceGoal, TrainingSession } from "./types";

/** How far back goal confidence looks for planned sessions (`race_prediction.py`'s
 * adherence window). */
export const ADHERENCE_LOOKBACK_DAYS = 42;

/** The sessions a race goal is read against, the same on every screen that reads it --
 * so Oggi and Obiettivo share one calendar request and one prediction in the cache.
 *
 * With a plan file that is the whole plan. With a live Garmin calendar it is the
 * calendar from six weeks back (what was planned, for adherence) to the race (what is
 * still to come); before a race exists, a fixed lookahead, enough to say "you have
 * sessions ahead" honestly. */
export function useGoalSessions({
  plan,
  goal,
  todayKey,
  liveMode,
}: {
  plan: { sessions: TrainingSession[] } | null | undefined;
  goal: RaceGoal | null | undefined;
  todayKey: string;
  liveMode: boolean;
}) {
  const racePassed = !!goal && goal.race_date < todayKey;
  const start = goal ? shiftDateKey(todayKey, -ADHERENCE_LOOKBACK_DAYS) : todayKey;
  const end = goal && !racePassed ? goal.race_date : shiftDateKey(todayKey, GOAL_LOOKAHEAD_DAYS);
  const workoutsQuery = useWorkouts(start, end, liveMode);
  const sessions = useMemo(
    () => plan?.sessions ?? workoutsToSessions(workoutsQuery.data?.workouts ?? []),
    [plan?.sessions, workoutsQuery.data]
  );
  return { sessions, workoutsQuery };
}
