"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { DetailScaffold } from "@/components/DetailScaffold";
import { SkeletonStravaPanel } from "@/components/skeletons";
import { StravaComparisonScreen } from "@/components/StravaComparisonScreen";
import { useMountOnce } from "@/lib/motion";
import { useStravaActivityMatch, useStravaStatus, useWorkoutSession, useWorkoutsForDate } from "@/lib/queries";

/** Full planned-vs-done comparison for a live Garmin-calendar workout (no local plan)
 * -- the same screen as `session/[id]/strava`, reached the same way: from the "Svolta,
 * da Strava" summary card on `workout/[id]`'s `SessionDetailBody`. */
function WorkoutStravaContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const animate = useMountOnce(`workout-strava-${params.id}`);
  const date = searchParams.get("date") ?? "";

  const workoutsQuery = useWorkoutsForDate(date, !!date);
  const workout = workoutsQuery.workouts.find((w) => String(w.scheduled_workout_id) === params.id) ?? null;
  const sessionQuery = useWorkoutSession(workout);
  const session = sessionQuery.data ?? null;

  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);

  return (
    <StravaComparisonScreen
      backHref={`/workout/${params.id}?date=${date}`}
      date={workout?.date ?? (date || null)}
      title={workout?.title ?? null}
      match={matchQuery.data}
      isLoading={!session || matchQuery.isPending}
      stravaConnected={!!stravaStatus.data?.connected}
      shoesFrom={`/workout/${params.id}/strava?date=${date}`}
      backLabel="Torna all'allenamento"
      animate={animate}
    />
  );
}

export default function WorkoutStravaPage() {
  return (
    <Suspense fallback={<DetailScaffold backHref="/week"><SkeletonStravaPanel /></DetailScaffold>}>
      <WorkoutStravaContent />
    </Suspense>
  );
}
