import type { RaceGoal } from "./types";

/** Reading a race goal out loud.
 *
 * Only formatting lives here. The one judgement in the whole feature -- which block of
 * the calendar today falls in -- is computed server-side (`models.race_phase`) and
 * arrives on the goal, so this file can never disagree with it.
 */

const KNOWN_DISTANCES: { km: number; label: string }[] = [
  { km: 42.195, label: "maratona" },
  { km: 21.0975, label: "mezza maratona" },
];

/** Within 100 m of a named distance is that distance: race courses are measured, plans
 * are typed by hand, and "42.2" is a marathon. */
const NAMED_DISTANCE_TOLERANCE_KM = 0.1;

export function distanceLabel(km: number): string {
  const named = KNOWN_DISTANCES.find((d) => Math.abs(d.km - km) <= NAMED_DISTANCE_TOLERANCE_KM);
  if (named) return named.label;
  const rounded = Math.round(km * 10) / 10;
  return `${String(rounded).replace(".", ",")} km`;
}

export function formatTargetTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const mmss = `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${mmss}` : mmss;
}

/** The pace that target time asks for, as m:ss/km. Derived, never stored: a goal states
 * a time, and the pace is what that time means over that distance. */
export function targetPaceSecPerKm(goal: RaceGoal): number | null {
  if (goal.target_time_seconds == null || goal.distance_km <= 0) return null;
  return Math.round(goal.target_time_seconds / goal.distance_km);
}

export function formatPaceSecPerKm(secPerKm: number): string {
  const minutes = Math.floor(secPerKm / 60);
  const seconds = secPerKm % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Days from `today` to the race. Plain date arithmetic, done here rather than read
 * from the server's `days_to_race` so a countdown is still right at 23:59 on a device
 * whose day has turned but whose cached answer was computed yesterday. */
export function daysToRace(goal: RaceGoal, today = new Date()): number {
  const race = new Date(`${goal.race_date}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((race.getTime() - start.getTime()) / 86_400_000);
}

/** "fra 9 settimane", "fra 5 giorni", "domani", "oggi", "3 giorni fa" -- how far the
 * race is, in the unit a runner would actually use at that distance. */
export function countdownLabel(goal: RaceGoal, today = new Date()): string {
  const days = daysToRace(goal, today);
  if (days === 0) return "oggi";
  if (days === 1) return "domani";
  if (days === -1) return "ieri";
  if (days < 0) {
    const past = Math.abs(days);
    return past >= 14 ? `${Math.round(past / 7)} settimane fa` : `${past} giorni fa`;
  }
  if (days < 14) return `fra ${days} giorni`;
  return `fra ${Math.round(days / 7)} settimane`;
}

/** The goal's own line: "Maratona di Firenze · maratona · 3:15:00". The name is
 * optional in the file, so the distance carries the line when there isn't one. */
export function goalTitle(goal: RaceGoal): string {
  return goal.name?.trim() || distanceLabel(goal.distance_km);
}
