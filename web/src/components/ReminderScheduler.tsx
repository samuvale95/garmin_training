"use client";

import { useEffect, useMemo } from "react";
import { apiPut } from "@/lib/apiClient";
import { useCalendarAccess } from "@/lib/guards";
import { refreshSubscription, usePushState } from "@/lib/push";
import { useFuelTargets, useWorkouts } from "@/lib/queries";
import { buildReminders, type ReminderOut } from "@/lib/reminders";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { usePassoStore } from "@/lib/store";
import { useTrainingSlot } from "@/lib/trainingHabits";

const SENT_KEY = "passo-push-reminders-sent";

/** Keeps the server's reminders in step with today's and tomorrow's fuel plan.
 *
 * Mounted once under the tabs. It renders nothing: it asks for the same fuel targets the
 * Nutrizione screen asks for (same query keys, so no extra requests when that screen is
 * open), turns them into reminders (`buildReminders`) and sends them whenever they
 * change. Tomorrow is included so a day without opening the app still gets its
 * breakfast reminder. Nothing happens unless this device is subscribed.
 */
export function ReminderScheduler() {
  const { state } = usePushState();
  const on = state === "on";
  const access = useCalendarAccess();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const meals = usePassoStore((s) => s.prefs.promemoriaPasti);
  const water = usePassoStore((s) => s.prefs.promemoriaAcqua);

  const today = toDateKey(new Date());
  const tomorrow = shiftDateKey(today, 1);
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWorkouts(today, shiftDateKey(today, 2), on && liveMode);
  const sessions = useMemo(
    () => (access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? [])),
    [access.plan, workoutsQuery.data]
  );
  const sessionsReady = on && access.ready && (!liveMode || !workoutsQuery.isPending);

  const slotToday = useTrainingSlot(today, on && access.ready);
  const slotTomorrow = useTrainingSlot(tomorrow, on && access.ready);
  const fuelToday = useFuelTargets(today, sessions, manualWeight?.weightKg, sessionsReady && slotToday.ready, slotToday.slot);
  const fuelTomorrow = useFuelTargets(tomorrow, sessions, manualWeight?.weightKg, sessionsReady && slotTomorrow.ready, slotTomorrow.slot);

  // The browser rotated the subscription (sw.js says so): send the new one.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === "passo-push-resubscribe") refreshSubscription();
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // Once per app start, re-send this device to the server: it may have been dropped
  // after a failed delivery, and re-adding costs one upsert.
  useEffect(() => {
    if (on) refreshSubscription();
  }, [on]);

  useEffect(() => {
    if (!on || !fuelToday.data || fuelToday.isPlaceholderData) return;
    if (fuelTomorrow.isPending && fuelTomorrow.fetchStatus !== "idle") return;
    const now = new Date();
    const kinds = { meals, water };
    const reminders: ReminderOut[] = [
      ...buildReminders(today, fuelToday.data, now, kinds),
      ...(fuelTomorrow.data && !fuelTomorrow.isPlaceholderData ? buildReminders(tomorrow, fuelTomorrow.data, now, kinds) : []),
    ];
    const body = { days: [today, tomorrow], reminders };
    const fingerprint = JSON.stringify(body);
    let last: string | null = null;
    try {
      last = sessionStorage.getItem(SENT_KEY);
    } catch {
      /* private mode: send anyway */
    }
    if (last === fingerprint) return;
    apiPut("/push/reminders", body)
      .then(() => {
        try {
          sessionStorage.setItem(SENT_KEY, fingerprint);
        } catch {
          /* nothing to remember it in */
        }
      })
      .catch(() => {});
  }, [on, meals, water, today, tomorrow, fuelToday.data, fuelToday.isPlaceholderData, fuelTomorrow.data, fuelTomorrow.isPlaceholderData, fuelTomorrow.isPending, fuelTomorrow.fetchStatus]);

  return null;
}
