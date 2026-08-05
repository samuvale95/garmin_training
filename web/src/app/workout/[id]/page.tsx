"use client";

import { Suspense, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { SessionDetailBody } from "@/components/SessionDetailBody";
import { useMountOnce } from "@/lib/motion";
import {
  useApplyDeletion,
  useStravaActivityMatch,
  useStravaStatus,
  useWorkoutSession,
  useWorkouts,
} from "@/lib/queries";
import { ApiError } from "@/lib/apiClient";
import { formatFullDate } from "@/lib/format";

/** Detail view for a workout that comes straight from the Garmin calendar (no plan
 * imported -- see `web/src/app/(tabs)/week/page.tsx`'s `liveMode`). Unlike
 * `session/[id]`, there's no local index to key off of (no `plan.sessions` array), so
 * the route is keyed by the workout's own `scheduled_workout_id`, with the date passed
 * as a query param since `useWorkouts` needs a date range to look it up. The step
 * structure itself comes from `useWorkoutSession` (Garmin's own copy of the workout,
 * read back via `get_workout_by_id`), so this renders the exact same
 * `SessionDetailBody` an imported plan's session does, instead of a thinner
 * Strava-only stand-in. */
function WorkoutDetailContent() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const animate = useMountOnce(`workout-${params.id}`);
  const date = searchParams.get("date") ?? "";

  const workoutsQuery = useWorkouts(date, date, !!date);
  const workout = workoutsQuery.data?.workouts.find((w) => String(w.scheduled_workout_id) === params.id) ?? null;

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

  if (!date || workoutsQuery.isLoading) return null;

  if (!workout) {
    return (
      <div style={{ padding: 22 }}>
        <PageHeader backHref="/week" />
        <p>Allenamento non trovato.</p>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader backHref="/week" color="var(--crema)" />
          <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>
            {formatFullDate(workout.date)} · dal calendario Garmin
          </span>
        </div>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isDeleting}
          className="tap-target"
          aria-label="Elimina allenamento"
          style={{ background: "none", border: "none", fontSize: 18, color: "var(--rosso-avviso)", cursor: isDeleting ? "default" : "pointer", opacity: isDeleting ? 0.6 : 1 }}
        >
          🗑
        </button>
      </div>

      {confirmDelete && (
        <div style={{ alignSelf: "stretch", background: "rgba(246,238,218,.1)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <p style={{ fontSize: 13, margin: 0, flex: 1 }}>Eliminare questo allenamento dal calendario Garmin?</p>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="tap-target"
            style={{ background: "var(--rosso-forte)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: isDeleting ? "default" : "pointer" }}
          >
            {isDeleting ? "..." : "Elimina"}
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} disabled={isDeleting} className="tap-target" style={{ background: "none", border: "none", fontSize: 12, color: "var(--inchiostro-su-scuro)", cursor: "pointer" }}>
            Annulla
          </button>
        </div>
      )}
      {deleteError && (
        <p style={{ alignSelf: "stretch", color: "var(--rosso-avviso)", fontSize: 13, marginTop: 10 }} role="alert">
          {deleteError}
        </p>
      )}

      <SessionDetailBody
        session={session}
        animate={animate}
        hasStravaMatch={hasStravaMatch}
        matchData={matchQuery.data}
        stravaHref={`/workout/${params.id}/strava?date=${date}`}
      />

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <button
          type="button"
          onClick={() => router.push("/week")}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--crema)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Torna alla settimana
        </button>
      </div>
    </div>
  );
}

export default function WorkoutDetailPage() {
  return (
    <Suspense fallback={null}>
      <WorkoutDetailContent />
    </Suspense>
  );
}
