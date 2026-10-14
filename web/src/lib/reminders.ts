import { calculateHydrationMl } from "./notifications";
import type { FuelTargets, MealSlot } from "./types";

/** One push reminder, as `PUT /push/reminders` takes it. */
export interface ReminderOut {
  tag: string;
  send_at: string; // ISO with offset
  title: string;
  body: string;
  url: string;
}

export interface ReminderKinds {
  meals: boolean;
  water: boolean;
}

// The water reminder: early enough to drink and still go to the bathroom before leaving.
export const WATER_BEFORE_MINUTES = 45;
// Nothing scheduled for the next minute: by the time it is stored it would be stale.
const MIN_LEAD_MS = 60_000;

/** "2026-10-14" + "13:00" in the phone's own time zone. */
export function localMoment(day: string, clock: string): Date {
  const [h, m] = clock.split(":").map(Number);
  const [y, mo, d] = day.split("-").map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
}

function capitalized(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function plate(meal: MealSlot): string {
  const foods = meal.portions.slice(0, 4).map((p) => (p.grams != null ? `${p.food} ${p.grams} g` : p.food));
  return foods.join(" · ");
}

function mealTitle(meal: MealSlot, clock: string): string {
  if (meal.role === "pre") return `Prima di correre · ${meal.name}`;
  if (meal.role === "post") return `Recupero · ${meal.name}`;
  return `${meal.name} · ${clock}`;
}

/** The day's reminders from its fuel plan: one per meal at its time, and the water
 * before the session. Only those still ahead of `now`. The same plate the Nutrizione
 * screen shows -- a reminder that said something else would be a second plan. */
export function buildReminders(day: string, fuel: FuelTargets, now: Date, kinds: ReminderKinds): ReminderOut[] {
  const out: ReminderOut[] = [];
  if (kinds.meals) {
    for (const meal of fuel.meals) {
      if (!meal.clock) continue;
      const at = localMoment(day, meal.clock);
      const body = plate(meal) || meal.timing;
      out.push({
        tag: `${day}:pasto-${meal.key}`,
        send_at: at.toISOString(),
        title: mealTitle(meal, meal.clock),
        body: capitalized(meal.note && meal.role ? `${body}. ${capitalized(meal.note)}` : body),
        url: "/nutrition",
      });
    }
  }
  if (kinds.water && fuel.session_clock && fuel.today.load !== "riposo") {
    const start = localMoment(day, fuel.session_clock);
    const at = new Date(start.getTime() - WATER_BEFORE_MINUTES * 60_000);
    const ml = calculateHydrationMl(fuel.today.duration_minutes, fuel.today.load === "molto_lungo");
    const session = fuel.today.session_title ? fuel.today.session_title.toLowerCase() : "l'allenamento";
    out.push({
      tag: `${day}:acqua`,
      send_at: at.toISOString(),
      title: "Acqua prima di correre",
      body: `Circa ${ml} ml a piccoli sorsi: alle ${fuel.session_clock} c'è ${session}.`,
      url: "/nutrition",
    });
  }
  const cutoff = now.getTime() + MIN_LEAD_MS;
  return out.filter((r) => new Date(r.send_at).getTime() > cutoff).sort((a, b) => a.send_at.localeCompare(b.send_at));
}
