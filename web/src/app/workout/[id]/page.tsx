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
import { useScreenReady } from "@/lib/useScreenReady";

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
  useScreenReady(!!session || sessionQuery.isError || (!workout && !!date && !workoutsQuery.isPending && !workoutsQuery.isFetching));

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
            <Link data-track="workout.id.modifica-allenamento"
              href={`/workout/${params.id}/edit?date=${date}`}
              className="tap-target"
              aria-label="Modifica allenamento"
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "var(--sabbia-chip)",
                border: "1px solid var(--border-airbnb)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--inchiostro)",
                textDecoration: "none",
                boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
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
          <Link data-track="workout.id.week"
            href="/week"
            className="tap-target"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "var(--sabbia-chip)",
              border: "1px solid var(--border-airbnb)",
              borderRadius: "var(--radius-pill)",
              padding: "10px 20px",
              color: "var(--inchiostro)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              transition: "all 0.15s ease",
            }}
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
