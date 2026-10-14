"use client";

import { useActivities } from "./queries";
import { shiftDateKey } from "./sessionVisuals";
import { toMinutes, useClockMinutes } from "./fuelMoment";
import { SLOT_START, type TrainingSlot } from "./trainingHabits";

/** What the day is about right now, so a screen can put that first.
 *
 * The same numbers matter at different times. At seven in the morning, how the night
 * went decides the session; at six in the evening, after the session, the night is old
 * news and what matters is how much is left in the tank and what tomorrow asks for; on a
 * rest-day evening, it is tomorrow. Each screen keeps the same blocks and reorders them
 * by this one answer, so Oggi and Corpo never disagree about what time of day it is.
 */
export type DayFocus =
  /** Morning, or before today's session: readiness, the night, whether to train hard. */
  | "prontezza"
  /** A session is already recorded today: energy left, stress, recovery, tomorrow. */
  | "recupero"
  /** Evening with nothing (more) to train today: tomorrow comes first. */
  | "domani";

// From here on "today" is mostly over: the next thing that can be acted on is tomorrow.
export const EVENING_MINUTES = 18 * 60;
// How long after its usual start a session not yet recorded still counts as coming up --
// the watch takes a while to sync, and a late start is not a skipped session.
const SESSION_GRACE_MINUTES = 150;

export function dayFocus({
  nowMinutes,
  trainedToday,
  sessionToday,
  sessionStartMinutes,
}: {
  nowMinutes: number | null;
  trainedToday: boolean;
  sessionToday: boolean;
  sessionStartMinutes: number | null;
}): DayFocus {
  if (trainedToday) return "recupero";
  if (nowMinutes == null) return "prontezza";
  const sessionAhead = sessionToday && sessionStartMinutes != null && nowMinutes < sessionStartMinutes + SESSION_GRACE_MINUTES;
  if (sessionAhead) return "prontezza";
  return nowMinutes >= EVENING_MINUTES ? "domani" : "prontezza";
}

/** One line under a screen's title saying why it is ordered the way it is. */
export const FOCUS_LINE: Record<DayFocus, string> = {
  prontezza: "Prima di allenarti: come hai dormito e quanto sei pronto.",
  recupero: "Dopo l'allenamento: energia rimasta, stress e cosa ti aspetta domani.",
  domani: "È sera: conta come arrivi a domani.",
};

/** `dayFocus` for today, from the clock, the watch and the plan. The activity query is
 * the same one Oggi uses for its check-in, so the two screens share one request. */
export function useDayFocus({
  todayKey,
  sessionToday,
  training,
  garminConnected,
  enabled,
}: {
  todayKey: string;
  sessionToday: boolean;
  training: TrainingSlot;
  garminConnected: boolean;
  enabled: boolean;
}): { focus: DayFocus; trainedToday: boolean } {
  const nowMinutes = useClockMinutes();
  const activities = useActivities(shiftDateKey(todayKey, -1), todayKey, enabled && garminConnected);
  const trainedToday = (activities.data?.activities ?? []).some((a) => a.date === todayKey);
  const sessionStartMinutes =
    training.source === "abitudine" && training.habit?.minutes != null ? training.habit.minutes : toMinutes(SLOT_START[training.slot]);
  return { focus: dayFocus({ nowMinutes, trainedToday, sessionToday, sessionStartMinutes }), trainedToday };
}
