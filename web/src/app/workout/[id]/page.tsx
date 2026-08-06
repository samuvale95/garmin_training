"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { SessionDetailBody } from "@/components/SessionDetailBody";
import { DeleteConfirmStrip, DeleteIconButton, DetailScaffold } from "@/components/DetailScaffold";
import { SkeletonDetailBody } from "@/components/skeletons";
import { useMountOnce } from "@/lib/motion";
import {
  useApplyDeletion,
  useStravaActivityMatch,
  useStravaStatus,
  useWorkoutSession,
  useWorkoutsForDate,
} from "@/lib/queries";
import { ApiError } from "@/lib/apiClient";
import { formatFullDate } from "@/lib/format";

/** Detail view for a workout that comes straight from the Garmin calendar (no plan
 * imported -- see `web/src/app/(tabs)/week/page.tsx`'s `liveMode`). Unlike
 * `session/[id]`, there's no local index to key off of (no `plan.sessions` array), so
 * the route is keyed by the workout's own `scheduled_workout_id`, with the date passed
 * as a query param since the calendar is looked up by date. The step structure itself
 * comes from `useWorkoutSession` (Garmin's own copy of the workout, read back via
 * `get_workout_by_id`), so this renders the exact same `SessionDetailBody` an imported
 * plan's session does, instead of a thinner Strava-only stand-in. */
function WorkoutDetailContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const animate = useMountOnce(`workout-${params.id}`);
  const date = searchParams.get("date") ?? "";

  // Served from the cached week Settimana already loaded -- the workout is normally
  // already here, so this screen opens without waiting on Garmin at all.
  const workoutsQuery = useWorkoutsForDate(date, !!date);
  const workout = workoutsQuery.workouts.find((w) => String(w.scheduled_workout_id) === params.id) ?? null;

  const sessionQuery = useWorkoutSession(workout);
  const session = sessionQuery.data ?? null;

  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);
  const hasStravaMatch = !!stravaStatus.data?.connected && !!matchQuery.data?.matched;

  const applyDeletion = useApplyDeletion();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete() {
    if (!workout) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleteError(null);
    setIsDeleting(true);
    try {
      await applyDeletion.mutateAsync([workout]);
      router.push("/week");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Non sono riuscito a cancellare l'allenamento.");
      setIsDeleting(false);
    }
  }

  // Only a genuinely finished, genuinely empty lookup means "not found" -- while the
  // week is still loading, the frame plus a loading body is the honest answer.
  if (!workout) {
    if (!date || workoutsQuery.isPending || workoutsQuery.isFetching) {
      return (
        <DetailScaffold backHref="/week" caption={date ? formatFullDate(date) : undefined}>
          <SkeletonDetailBody />
        </DetailScaffold>
      );
    }
    return (
      <div style={{ padding: 22 }}>
        <PageHeader backHref="/week" />
        <p>Allenamento non trovato.</p>
      </div>
    );
  }

  return (
    <DetailScaffold
      backHref="/week"
      caption={`${formatFullDate(workout.date)} · dal calendario Garmin`}
      error={deleteError}
      actions={
        <>
          {/* Only once the step structure is here: the editor is seeded from it, and a
              pencil tapped before it lands would open an empty form. */}
          {session && (
            <Link
              href={`/workout/${params.id}/edit?date=${date}`}
              className="tap-target"
              aria-label="Modifica allenamento"
              style={{ color: "var(--crema)", fontSize: 18, textDecoration: "none" }}
            >
              ✎
            </Link>
          )}
          <DeleteIconButton onClick={handleDelete} disabled={isDeleting} />
        </>
      }
      confirm={
        confirmDelete && (
          <DeleteConfirmStrip
            message="Eliminare questo allenamento dal calendario Garmin?"
            isDeleting={isDeleting}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )
      }
      footer={
        <div style={{ marginTop: 28, textAlign: "center" }}>
          <Link
            href="/week"
            className="tap-target"
            style={{ color: "var(--crema)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            Torna alla settimana
          </Link>
        </div>
      }
    >
      {session ? (
        <SessionDetailBody
          session={session}
          animate={animate}
          hasStravaMatch={hasStravaMatch}
          matchData={matchQuery.data}
          stravaHref={`/workout/${params.id}/strava?date=${date}`}
        />
      ) : (
        // The step structure is a second Garmin read; the title/date above are already
        // on screen, so only the body waits.
        <SkeletonDetailBody />
      )}
    </DetailScaffold>
  );
}

export default function WorkoutDetailPage() {
  return (
    <Suspense fallback={<DetailScaffold backHref="/week"><SkeletonDetailBody /></DetailScaffold>}>
      <WorkoutDetailContent />
    </Suspense>
  );
}
