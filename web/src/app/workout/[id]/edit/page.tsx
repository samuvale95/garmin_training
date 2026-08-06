"use client";

import { Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { WorkoutEditor } from "@/components/WorkoutEditor";
import { SkeletonEditorForm } from "@/components/skeletons";
import { useWorkoutSession, useWorkoutsForDate } from "@/lib/queries";

/** Editing a workout that lives only on the Garmin calendar -- the twin of
 * `session/[id]/edit`, for the case where nothing was ever imported (see
 * `workout/[id]`). Same form, opened on Garmin's own copy of the workout.
 *
 * The editor is mounted only once that copy is here: it seeds its form state from its
 * props at mount and never re-reads them, so mounting it early would build the form out
 * of a workout with no steps and then silently keep it. */
function WorkoutEditContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const date = searchParams.get("date") ?? "";

  // Both served from the same caches `workout/[id]` just filled, so arriving here from
  // the detail screen normally costs no Garmin call at all.
  const workoutsQuery = useWorkoutsForDate(date, !!date);
  const workout = workoutsQuery.workouts.find((w) => String(w.scheduled_workout_id) === params.id) ?? null;
  const sessionQuery = useWorkoutSession(workout);
  const session = sessionQuery.data ?? null;

  if (workout && session) {
    return <WorkoutEditor mode="garmin" workout={workout} session={session} />;
  }

  const notFound = !workout && !!date && workoutsQuery.isSuccess;
  const failed = sessionQuery.isError;
  if (notFound || failed) {
    return (
      <div style={{ minHeight: "100dvh", background: "var(--crema)", padding: 22 }}>
        <PageHeader backHref="/week" />
        <p style={{ marginTop: 16 }}>
          {notFound ? "Allenamento non trovato." : "Non sono riuscito a leggere questo allenamento."}
        </p>
      </div>
    );
  }

  return <SkeletonEditorForm />;
}

export default function WorkoutEditPage() {
  return (
    <Suspense fallback={<SkeletonEditorForm />}>
      <WorkoutEditContent />
    </Suspense>
  );
}
