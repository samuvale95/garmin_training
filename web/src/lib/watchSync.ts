"use client";

import { useActivities, useBodyToday, useGarminDevice, useGarminStatus, usePlanQuery, useWeekWorkouts } from "./queries";
import { toDateKey, weekBounds, type DisplaySession } from "./sessionVisuals";

/** Past this, Oggi/Come stai would be reading yesterday's body as if it were this
 * morning's -- so screen 19 stands in for them instead (19-orologio-non-sincronizzato.md). */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type MissingMetricKind = "sonno" | "prontezza" | "hrv" | "sessioni";

export interface MissingMetric {
  kind: MissingMetricKind;
  /** Only meaningful for `sessioni`. */
  count?: number;
}

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Has it been more than a day? A plain function, not an expression in the hook body,
 * so the render-purity rule doesn't (rightly) flag the `Date.now()` behind it. */
function isStaleSync(isoTimestamp: string | null): boolean {
  if (!isoTimestamp) return false;
  const then = new Date(isoTimestamp).getTime();
  return !Number.isNaN(then) && Date.now() - then > STALE_AFTER_MS;
}

/** "stanotte" · "ieri" · "N giorni fa" · "più di una settimana".
 *
 * A plain function rather than something computed in a component body, for the same
 * reason `minutesAgo` in format.ts is one: it reads `Date.now()`, which isn't pure. */
export function lastSyncLabel(isoTimestamp: string | null): string {
  if (!isoTimestamp) return "non lo so";
  const then = new Date(isoTimestamp);
  if (Number.isNaN(then.getTime())) return "non lo so";

  const now = new Date();
  if (now.getTime() - then.getTime() < 12 * 60 * 60 * 1000) return "stanotte";

  const days = Math.round((startOfDayMs(now) - startOfDayMs(then)) / 86_400_000);
  if (days <= 1) return "ieri";
  if (days <= 7) return `${days} giorni fa`;
  return "più di una settimana";
}

/** The phrase inside a list: "sonno, prontezza e 2 sessioni svolte". */
function metricPhrase(metric: MissingMetric): string {
  switch (metric.kind) {
    case "sonno":
      return "sonno";
    case "prontezza":
      return "prontezza";
    case "hrv":
      return "HRV";
    case "sessioni":
      return metric.count === 1 ? "1 sessione svolta" : `${metric.count} sessioni svolte`;
  }
}

/** The same metric as the whole sentence's subject, where it needs its article:
 * "Manca il sonno." */
function loneMetricPhrase(metric: MissingMetric): string {
  switch (metric.kind) {
    case "sonno":
      return "il sonno";
    case "prontezza":
      return "la prontezza";
    case "hrv":
      return "l'HRV";
    case "sessioni":
      return metricPhrase(metric);
  }
}

/** "Mancano sonno, prontezza e 2 sessioni svolte." -- the card's note.
 *
 * The verb agrees with the *phrase*, not the number of entries: a single missing metric
 * reads "Manca il sonno", but a single entry standing for two sessions is still plural. */
export function missingDataNote(missing: MissingMetric[]): string | null {
  if (missing.length === 0) return null;

  if (missing.length === 1) {
    const only = missing[0];
    const plural = only.kind === "sessioni" && only.count !== 1;
    return `${plural ? "Mancano" : "Manca"} ${loneMetricPhrase(only)}.`;
  }

  const parts = missing.map(metricPhrase);
  const last = parts.pop();
  return `Mancano ${parts.join(", ")} e ${last}.`;
}

export interface WatchSyncStatus {
  /** False while any input is still unanswered -- callers must not redirect before this,
   * or a cold start would flash screen 19 at everyone. */
  ready: boolean;
  lastSyncedAt: string | null;
  missing: MissingMetric[];
  /** Sync older than 24h *and* something actually missing because of it. A stale sync
   * with nothing missing is not this screen's business (spec, "Contenuto dinamico"). */
  blocking: boolean;
}

/**
 * "Has the watch spoken today?" -- the condition behind screen 19.
 *
 * Every query it reads is one Oggi/Come stai already load, so asking this costs no extra
 * round trip on the screens that gate on it.
 */
export function useWatchSyncStatus(): WatchSyncStatus {
  const status = useGarminStatus();
  const connected = status.data?.connected ?? false;
  const device = useGarminDevice(connected);
  const body = useBodyToday();
  const { data: plan } = usePlanQuery();

  const today = new Date();
  const todayKey = toDateKey(today);
  const { start, end } = weekBounds(today);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);

  const liveMode = !plan && connected;
  const workouts = useWeekWorkouts(today, liveMode);
  // Same (start, end) pair Settimana uses, so this hits that cache entry rather than
  // minting a second one for a range only this hook would ever ask for.
  const activities = useActivities(startKey, endKey, connected);

  const lastSyncedAt = device.data?.last_synced_at ?? null;
  const stale = isStaleSync(lastSyncedAt);

  // Sessions the calendar says are behind us but Garmin has no activity for. It's a
  // proxy: the app can't see the watch's own memory, so "planned, past, and nothing
  // uploaded for that day" is the closest it gets to "done but not yet arrived".
  // Deliberately excludes today -- this screen is seen in the morning, before the day's
  // session has happened at all.
  const sessions: DisplaySession[] = plan ? plan.sessions : workouts.data?.workouts ?? [];
  const uploadedDates = new Set((activities.data?.activities ?? []).map((a) => a.date));
  const sinceKey = lastSyncedAt ? toDateKey(new Date(lastSyncedAt)) : startKey;
  const pendingSessions = sessions.filter(
    (s) => s.date > sinceKey && s.date < todayKey && !uploadedDates.has(s.date)
  ).length;

  const missing: MissingMetric[] = [];
  if (body.data) {
    if (body.data.sleep?.total_minutes == null) missing.push({ kind: "sonno" });
    if (body.data.readiness_score == null) missing.push({ kind: "prontezza" });
    if (body.data.hrv_last_night_ms == null) missing.push({ kind: "hrv" });
  }
  if (pendingSessions > 0) missing.push({ kind: "sessioni", count: pendingSessions });

  const ready = status.isFetched && (!connected || (device.isFetched && body.isFetched));

  return {
    ready,
    lastSyncedAt,
    missing,
    blocking: connected && stale && missing.length > 0,
  };
}
