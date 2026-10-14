"use client";

import { useStoredActivities } from "./queries";
import { usePassoStore } from "./store";
import { shiftDateKey } from "./sessionVisuals";
import type { SessionSlot, StoredActivity } from "./types";

/** When does this person train? Read from what they actually did, not asked.
 *
 * A plan has dates and no times, so "when is today's session" used to be a question on
 * the screen with "pomeriggio" pre-selected -- answered, in practice, by whatever the
 * default was. The watch already knows: every recorded activity has a start time. Eight
 * weeks of them, grouped by day of the week, say that on Tuesdays this runner goes out
 * at 7 and on Saturdays at 9, which is the answer the meals of the day are built around.
 *
 * Done here rather than on the server because the stored start times are UTC and only
 * the phone knows which timezone "7 in the morning" is in.
 */

/** The clock time each slot stands for -- the same figures the backend places meals
 * around (`SESSION_START_MINUTES` in training_plan/nutrition.py). */
export const SLOT_START: Record<SessionSlot, string> = {
  mattina: "07:30",
  mezzogiorno: "12:30",
  pomeriggio: "18:00",
  sera: "19:30",
};

export const SLOT_LABEL: Record<SessionSlot, string> = {
  mattina: "Mattina",
  mezzogiorno: "Pausa pranzo",
  pomeriggio: "Pomeriggio",
  sera: "Sera",
};

const WEEKDAY_NAMES = ["la domenica", "il lunedì", "il martedì", "il mercoledì", "il giovedì", "il venerdì", "il sabato"];

// How far back the habit is read. Long enough to see several of each weekday, short
// enough that a change of job or season shows up within a couple of months.
export const HABIT_WINDOW_DAYS = 56;
// A weekday needs this many sessions to speak for itself; below it, the whole week's
// habit is used instead, and below *that*, nothing is claimed.
const MIN_SAME_WEEKDAY = 2;
const MIN_ANY_DAY = 3;
// Walks are not training sessions to eat around.
const IGNORED_FAMILIES = new Set(["walk"]);
const MIN_ACTIVITY_MINUTES = 15;

/** The slot a local start time falls into. */
export function slotForMinutes(minutes: number): SessionSlot {
  if (minutes < 10 * 60 + 30) return "mattina";
  if (minutes < 15 * 60) return "mezzogiorno";
  if (minutes < 19 * 60) return "pomeriggio";
  return "sera";
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes / 5) * 5;
  return `${String(Math.floor(rounded / 60)).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

export interface TrainingHabit {
  slot: SessionSlot | null;
  /** Median local start time, minutes after midnight. */
  minutes: number | null;
  /** "giorno": read from this weekday alone; "settimana": from every day, because this
   * weekday has too few sessions to say anything on its own. */
  basis: "giorno" | "settimana" | null;
  samples: number;
  weekday: number;
}

/** The usual start time on `weekday` (0 = Sunday), from recorded activities. */
export function usualTrainingTime(activities: StoredActivity[], weekday: number): TrainingHabit {
  const starts: { weekday: number; minutes: number }[] = [];
  for (const activity of activities) {
    if (!activity.start_time || IGNORED_FAMILIES.has(activity.family) || activity.minutes < MIN_ACTIVITY_MINUTES) continue;
    const start = new Date(activity.start_time);
    if (Number.isNaN(start.getTime())) continue;
    starts.push({ weekday: start.getDay(), minutes: start.getHours() * 60 + start.getMinutes() });
  }

  const sameDay = starts.filter((s) => s.weekday === weekday).map((s) => s.minutes);
  if (sameDay.length >= MIN_SAME_WEEKDAY) {
    const minutes = median(sameDay);
    return { slot: slotForMinutes(minutes), minutes, basis: "giorno", samples: sameDay.length, weekday };
  }
  if (starts.length >= MIN_ANY_DAY) {
    const minutes = median(starts.map((s) => s.minutes));
    return { slot: slotForMinutes(minutes), minutes, basis: "settimana", samples: starts.length, weekday };
  }
  return { slot: null, minutes: null, basis: null, samples: starts.length, weekday };
}

/** One sentence saying where the time came from, for the screen to print next to it. */
export function habitSentence(habit: TrainingHabit): string | null {
  if (habit.minutes == null) return null;
  const at = formatMinutes(habit.minutes);
  return habit.basis === "giorno"
    ? `Di solito ${WEEKDAY_NAMES[habit.weekday]} parti verso le ${at}.`
    : `Di solito parti verso le ${at}.`;
}

export type SlotSource = "oggi" | "abitudine" | "predefinito";

export interface TrainingSlot {
  slot: SessionSlot;
  source: SlotSource;
  habit: TrainingHabit | null;
  /** False until the activities have answered (or failed to): asking for the day's
   * meals before then would ask twice, once with the default and once with the habit. */
  ready: boolean;
  setForToday: (slot: SessionSlot | null) => void;
}

/** When the session on `dateKey` happens: what the user said for that day, else their
 * habit for that weekday, else the afternoon. */
export function useTrainingSlot(dateKey: string, enabled = true): TrainingSlot {
  const override = usePassoStore((s) => s.trainingSlotOverride);
  const setOverride = usePassoStore((s) => s.setTrainingSlotOverride);
  const activities = useStoredActivities(shiftDateKey(dateKey, -HABIT_WINDOW_DAYS), shiftDateKey(dateKey, -1), enabled);

  const weekday = new Date(`${dateKey}T12:00:00`).getDay();
  const habit = activities.data ? usualTrainingTime(activities.data.activities, weekday) : null;
  const ready = !enabled || activities.isSuccess || activities.isError;
  const setForToday = (slot: SessionSlot | null) => setOverride(dateKey, slot);

  if (override && override.date === dateKey) return { slot: override.slot, source: "oggi", habit, ready: true, setForToday };
  if (habit?.slot) return { slot: habit.slot, source: "abitudine", habit, ready, setForToday };
  return { slot: "pomeriggio", source: "predefinito", habit, ready, setForToday };
}
