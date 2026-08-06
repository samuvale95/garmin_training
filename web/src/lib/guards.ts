"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGarminStatus, usePlanQuery, type PlanState } from "./queries";

/** Screens that need an imported plan redirect to /import when there isn't one --
 * matching the "no plan imported -> screen 03 is the home" empty state.
 *
 * `isHydrated` is returned alongside the plan because the two "no plan" states look the
 * same but must not render the same: before the localStorage read has happened (one tick
 * after mount) the answer is simply unknown, and a screen should show its loading shape;
 * after it, there really is no plan and we're on our way to /import.
 */
export function useRequirePlan(): { plan: PlanState | null; isHydrated: boolean } {
  const router = useRouter();
  const { data: plan, isHydrated } = usePlanQuery();

  useEffect(() => {
    if (isHydrated && !plan) router.replace("/import");
  }, [isHydrated, plan, router]);

  return { plan: plan ?? null, isHydrated };
}

export interface CalendarAccess {
  plan: PlanState | null;
  garminConnected: boolean;
  /** False while we don't yet know whether to redirect -- avoids bouncing a
   * Garmin-connected device to /import for a flash before the status check lands. */
  ready: boolean;
}

/** Oggi/Settimana can show something useful with either an imported plan or just a
 * live Garmin connection (its calendar of already-scheduled workouts). Only redirect
 * to /import once neither is available. */
export function useCalendarAccess(): CalendarAccess {
  const router = useRouter();
  const { data: plan, isHydrated } = usePlanQuery();
  const status = useGarminStatus();
  const garminConnected = status.data?.connected ?? false;
  const ready = (isHydrated && plan != null) || status.isFetched;

  useEffect(() => {
    if (ready && !plan && !garminConnected) router.replace("/import");
  }, [ready, plan, garminConnected, router]);

  return { plan: plan ?? null, garminConnected, ready };
}
