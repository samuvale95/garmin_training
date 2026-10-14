/** How much to drink before a session, for the water reminder (`reminders.ts`) and the
 * pre-run card. Delivery of the reminders themselves is `push.ts`. */

export function calculateHydrationMl(durationMinOrKm?: number | null, isLong?: boolean): number {
  if (!durationMinOrKm || durationMinOrKm <= 0) return 350;
  // If value is > 25, it's duration in minutes; otherwise distance in km
  if (durationMinOrKm > 25) {
    if (isLong || durationMinOrKm >= 90) return 550;
    if (durationMinOrKm >= 50) return 450;
    return 350;
  }
  if (isLong || durationMinOrKm >= 18) return 550;
  if (durationMinOrKm >= 10) return 450;
  return 350;
}
