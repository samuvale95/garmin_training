"use client";

import { Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { WordIn } from "@/components/motion/primitives";
import { StravaMatchPanel } from "@/components/StravaMatchPanel";
import { useMountOnce } from "@/lib/motion";
import { useStravaActivityMatch, useStravaStatus, useWorkoutSession, useWorkouts } from "@/lib/queries";
import { formatFullDate } from "@/lib/format";

/** Full planned-vs-done comparison for a live Garmin-calendar workout (no local plan)
 * -- mirrors `session/[id]/strava`, reached the same way: from the "Svolta, da
 * Strava" summary card on `workout/[id]`'s `SessionDetailBody`. */
function WorkoutStravaContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const animate = useMountOnce(`workout-strava-${params.id}`);
  const date = searchParams.get("date") ?? "";

  const workoutsQuery = useWorkouts(date, date, !!date);
  const workout = workoutsQuery.data?.workouts.find((w) => String(w.scheduled_workout_id) === params.id) ?? null;
  const sessionQuery = useWorkoutSession(workout);
  const session = sessionQuery.data ?? null;

  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);

  if (!date || workoutsQuery.isLoading || !workout || !session) return null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref={`/workout/${params.id}?date=${date}`} color="var(--crema)" />
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>
          {formatFullDate(workout.date)} · da Strava
        </span>
      </div>

      <WordIn active={animate} style={{ font: "600 26px/1.1 var(--font-outfit)", marginTop: 16 }}>
        {workout.title}
      </WordIn>

      <StravaMatchPanel
        match={matchQuery.data}
        isLoading={matchQuery.isLoading}
        showPlanned
        shoesFrom={`/workout/${params.id}/strava?date=${date}`}
      />

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <button
          type="button"
          onClick={() => router.push(`/workout/${params.id}?date=${date}`)}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--crema)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Torna all&apos;allenamento
        </button>
      </div>
    </div>
  );
}

export default function WorkoutStravaPage() {
  return (
    <Suspense fallback={null}>
      <WorkoutStravaContent />
    </Suspense>
  );
}
