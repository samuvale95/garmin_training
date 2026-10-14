"use client";

import { useSyncExternalStore } from "react";
import { capitalize } from "./format";
import type { FuelTargets, MealSlot, Portion } from "./types";

/** Which part of the day's eating is happening *now* -- the one rule the Nutrizione tab
 * and the home screen both use, so they never point at two different meals.
 *
 * Everything else about the meals (grams, foods, clock times) comes from the server;
 * this only reads the clock against them.
 */

// A meal counts as "now" from a little before its time until a while after it: long
// enough to actually eat it, short enough that the screen moves on.
export const NOW_BEFORE_MINUTES = 20;
export const NOW_AFTER_MINUTES = 45;
// "Soon" for the home screen: close enough that the next meal is worth putting above
// everything else that is not urgent.
export const SOON_MINUTES = 60;

export function toMinutes(clock: string | null | undefined): number | null {
  if (!clock) return null;
  const [h, m] = clock.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
}

function minutesNow(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function subscribeToClock(onChange: () => void): () => void {
  const id = window.setInterval(onChange, 30_000);
  return () => window.clearInterval(id);
}

/** Minutes after midnight, re-read every half minute; null during server render, so the
 * page never hydrates around a time the server made up. */
export function useClockMinutes(): number | null {
  return useSyncExternalStore(subscribeToClock, minutesNow, () => null);
}

export function inHowLong(minutes: number): string {
  if (minutes < 60) return `tra ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `tra ${h} h` : `tra ${h} h ${m}`;
}

export function portionAmount(portion: Portion): string | null {
  if (portion.grams == null) return null;
  return portion.note ? `${portion.grams} g ${portion.note}` : `${portion.grams} g`;
}

export function portionsInline(portions: Portion[]): string {
  return portions.map((p) => (p.grams != null ? `${capitalize(p.food)} ${p.grams} g` : capitalize(p.food))).join(" · ");
}

export type Moment =
  | { kind: "meal"; meal: MealSlot; now: boolean; minutesUntil: number | null }
  | { kind: "session" }
  | { kind: "done" };

/** What the day's eating is about at `now` (minutes after midnight). */
export function currentMoment(fuel: FuelTargets, now: number | null): Moment {
  const meals = fuel.meals.filter((m) => toMinutes(m.clock) != null);
  if (meals.length === 0) return { kind: "done" };
  if (now == null) return { kind: "meal", meal: meals[0], now: false, minutesUntil: null };

  const start = toMinutes(fuel.session_clock);
  const length = fuel.today.duration_minutes ?? 60;
  if (start != null && now >= start - 10 && now < start + length) return { kind: "session" };

  for (const meal of meals) {
    const at = toMinutes(meal.clock)!;
    if (now >= at - NOW_BEFORE_MINUTES && now < at + NOW_AFTER_MINUTES) return { kind: "meal", meal, now: true, minutesUntil: 0 };
    if (at - NOW_BEFORE_MINUTES > now) return { kind: "meal", meal, now: false, minutesUntil: at - now };
  }
  return { kind: "done" };
}

/** Whether the moment is worth putting at the top of the home screen: a meal to eat now
 * or within the hour, the meal before or after the session, or the session itself. */
export function isUrgent(moment: Moment): boolean {
  if (moment.kind === "session") return true;
  if (moment.kind !== "meal") return false;
  return moment.now || moment.meal.role != null || (moment.minutesUntil != null && moment.minutesUntil <= SOON_MINUTES);
}
