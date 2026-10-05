"use client";

import { dis } from "@/lib/disabled";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton } from "@/components/motion/primitives";
import { CheckIcon } from "@/components/Icons";
import { SessionDetailBody } from "@/components/SessionDetailBody";
import { DeleteConfirmStrip, DeleteIconButton, DetailScaffold } from "@/components/DetailScaffold";
import { SkeletonDetailBody } from "@/components/skeletons";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { ApiError } from "@/lib/apiClient";
import {
  findPlanSession,
  useApplyDeletion,
  useRemoveSession,
  useStartSync,
  useStravaActivityMatch,
  useStravaStatus,
  useSyncJobStatus,
  useUpdateSession,
  useWorkoutsForDate,
} from "@/lib/queries";
import { normalizeTitle } from "@/lib/sessionVisuals";
import { formatWeekday } from "@/lib/format";
import type { TrainingSession } from "@/lib/types";
import { useScreenReady } from "@/lib/useScreenReady";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { plan, isHydrated } = useRequirePlan();
  useScreenReady(isHydrated);
  const animate = useMountOnce(`session-${params.id}`);
  const updateSession = useUpdateSession();
  const removeSession = useRemoveSession();
  const session = findPlanSession(plan, params.id);
  // Sessions are addressed by id; an old numeric link resolves once and moves to it.
  const sessionId = session?.id ?? params.id;
  useEffect(() => {
    if (session?.id && session.id !== params.id) router.replace(`/session/${session.id}`);
  }, [session?.id, params.id, router]);
  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);
  const hasStravaMatch = !!stravaStatus.data?.connected && !!matchQuery.data?.matched;

  // The session's identity on the Garmin calendar, if it has ever been synced there --
  // needed both to move it (delete the old scheduled entry, recreate on the new day)
  // and to delete it. Absent for a session that only exists in the local plan so far.
  // Read out of that day's cached *week*, which Oggi/Settimana already loaded: asking
  // for the single day would be a guaranteed cache miss and a fresh Garmin round-trip.
  const workoutsQuery = useWorkoutsForDate(session?.date ?? "", !!session);
  const originalWorkout = session
    ? workoutsQuery.workouts.find((w) => normalizeTitle(w.title) === normalizeTitle(session.title))
    : undefined;

  const startSync = useStartSync();
  const applyDeletion = useApplyDeletion();

  const [moveJobId, setMoveJobId] = useState<string | null>(null);
  const [movedDate, setMovedDate] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const moveStatus = useSyncJobStatus(moveJobId);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const moveItem = moveStatus.data?.items[0];
  const moveFailedMessage =
    moveStatus.data?.status === "failed"
      ? moveStatus.data.failure ?? "Non sono riuscito a spostare l'allenamento. Riprova."
      : moveStatus.data?.status === "done" && moveItem?.status === "failed"
        ? moveItem.error ?? "Non sono riuscito a spostare l'allenamento. Riprova."
        : null;
  const moveSucceeded = moveStatus.data?.status === "done" && moveItem?.status !== "failed";
  const isMoving = startSync.isPending || (!!moveJobId && !moveFailedMessage && !moveSucceeded);

  // Once the Garmin-side move settles successfully, commit the new date locally and
  // leave for the week screen -- mirrors WorkoutEditor's save-then-navigate effect.
  useEffect(() => {
    if (moveJobId && moveSucceeded && movedDate) {
      updateSession(sessionId, (s) => ({ ...s, date: movedDate }));
      router.push("/week");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveJobId, moveSucceeded, movedDate]);

  // The plan lives in localStorage and is read one tick after mount, so on the first
  // paint we simply don't know it yet. Render the frame with a loading body rather than
  // nothing -- this used to be a `return null`, i.e. a blank near-black screen.
  if (!plan) {
    return (
      <DetailScaffold backHref="/week">
        {isHydrated ? null : <SkeletonDetailBody />}
      </DetailScaffold>
    );
  }

  if (!session) {
    return (
      <div style={{ padding: 22 }}>
        <PageHeader backHref="/week" />
        <p>Sessione non trovata.</p>
      </div>
    );
  }

  const currentSession = session; // narrows the closures below to non-null, once

  function nextDayKey(): string {
    const current = new Date(currentSession.date);
    current.setDate(current.getDate() + 1);
    return current.toISOString().slice(0, 10);
  }

  async function moveToTomorrow() {
    setMoveError(null);
    const newDate = nextDayKey();
    const movedSession: TrainingSession = { ...currentSession, date: newDate };

    // No Garmin-side copy to move yet -- just update the local plan and go.
    if (!originalWorkout) {
      updateSession(sessionId, () => movedSession);
      router.push("/week");
      return;
    }

    // Otherwise, actually move it on the calendar: `changed` deletes the entry
    // scheduled on the current day and recreates it on the new one (see
    // GarminSync.replace_session), rather than only updating local state.
    try {
      const { job_id } = await startSync.mutateAsync({
        to_create: [],
        changed: [
          {
            session: movedSession,
            scheduled_workout_id: originalWorkout.scheduled_workout_id,
            workout_id: originalWorkout.workout_id,
            workout_date: originalWorkout.date,
            workout_sport: originalWorkout.sport,
            workout_title: originalWorkout.title,
          },
        ],
      });
      setMovedDate(newDate);
      setMoveJobId(job_id);
    } catch (err) {
      setMoveError(err instanceof ApiError ? err.message : "Non sono riuscito a spostare l'allenamento.");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleteError(null);
    setIsDeleting(true);
    try {
      if (originalWorkout) {
        await applyDeletion.mutateAsync([originalWorkout]);
      }
      removeSession(sessionId);
      router.push("/week");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Non sono riuscito a cancellare l'allenamento.");
      setIsDeleting(false);
    }
  }

  const displayMoveError = moveError ?? moveFailedMessage;

  return (
    <DetailScaffold
      backHref="/week"
      error={deleteError}
      actions={
        <>
          <Link data-track="session.id.modifica-allenamento"
            href={`/session/${sessionId}/edit`}
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
          <DeleteIconButton onClick={handleDelete} disabled={isDeleting} />
        </>
      }
      confirm={
        confirmDelete && (
          <DeleteConfirmStrip
            message="Eliminare questo allenamento dal piano e dal calendario Garmin?"
            isDeleting={isDeleting}
            onConfirm={handleDelete}
            onCancel={() => setConfirmDelete(false)}
          />
        )
      }
      stickyBottom={
        <div style={{ width: "100%", display: "flex", gap: 8, alignItems: "center" }}>
          <button data-track="session.id.movetotomorrow"
            type="button"
            onClick={moveToTomorrow}
            {...dis(isMoving, "in_caricamento")}
            className="press-soft"
            style={{
              flex: 1,
              background: "var(--crema-card)",
              border: "1px solid var(--border-airbnb)",
              borderRadius: "var(--radius-pill)",
              padding: "12px 16px",
              color: "var(--inchiostro)",
              fontSize: 13,
              fontWeight: 600,
              cursor: isMoving ? "default" : "pointer",
              boxShadow: "var(--shadow-airbnb-subtle)",
              textAlign: "center",
            }}
          >
            {isMoving ? "Sposto…" : `Sposta a ${formatWeekday(nextDayKey())}`}
          </button>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 12,
              fontWeight: 600,
              color: "var(--verde-testo)",
              background: "rgba(5, 150, 105, 0.1)",
              border: "1px solid rgba(5, 150, 105, 0.2)",
              borderRadius: "var(--radius-pill)",
              padding: "10px 14px",
              whiteSpace: "nowrap",
            }}
          >
            <CheckIcon size={13} strokeWidth={2.6} /> Nel piano
          </span>
        </div>
      }
      footer={
        displayMoveError ? (
          <p style={{ color: "var(--rosso-avviso)", fontSize: 13, textAlign: "center", margin: "14px 0 0" }} role="alert">
            {displayMoveError}
          </p>
        ) : null
      }
    >
      <SessionDetailBody
        session={currentSession}
        animate={animate}
        hasStravaMatch={hasStravaMatch}
        matchData={matchQuery.data}
        stravaHref={`/session/${sessionId}/strava`}
      />
    </DetailScaffold>
  );
}
