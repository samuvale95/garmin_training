"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, ProgressRing, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { ApiError } from "@/lib/apiClient";
import {
  useApplyDeletion,
  useRemoveSession,
  useStartSync,
  useStravaActivityMatch,
  useStravaStatus,
  useSyncJobStatus,
  useUpdateSession,
  useWorkouts,
} from "@/lib/queries";
import { normalizeTitle, sessionDistanceKm } from "@/lib/sessionVisuals";
import { formatPaceValue, formatWeekday, groupSteps, stepDistanceKm, stepGroupParts } from "@/lib/format";
import type { TrainingSession } from "@/lib/types";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const plan = useRequirePlan();
  const animate = useMountOnce(`session-${params.id}`);
  const updateSession = useUpdateSession();
  const removeSession = useRemoveSession();
  const index = Number(params.id);
  const session = plan?.sessions[index] ?? null;
  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);
  const hasStravaMatch = !!stravaStatus.data?.connected && !!matchQuery.data?.matched;

  // The session's identity on the Garmin calendar, if it has ever been synced there --
  // needed both to move it (delete the old scheduled entry, recreate on the new day)
  // and to delete it. Absent for a session that only exists in the local plan so far.
  const workoutsQuery = useWorkouts(session?.date ?? "", session?.date ?? "", !!session);
  const originalWorkout = session
    ? workoutsQuery.data?.workouts.find((w) => normalizeTitle(w.title) === normalizeTitle(session.title))
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
      updateSession(index, (s) => ({ ...s, date: movedDate }));
      router.push("/week");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moveJobId, moveSucceeded, movedDate]);

  if (!plan) return null;

  if (!session) {
    return (
      <div style={{ padding: 22 }}>
        <PageHeader backHref="/week" />
        <p>Sessione non trovata.</p>
      </div>
    );
  }

  const currentSession = session; // narrows the closures below to non-null, once
  const steps = currentSession.steps ?? []; // guards a stale localStorage plan saved before `steps` existed
  const distanceKm = sessionDistanceKm(currentSession);
  const groups = groupSteps(steps);

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
      updateSession(index, () => movedSession);
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
      removeSession(index);
      router.push("/week");
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : "Non sono riuscito a cancellare l'allenamento.");
      setIsDeleting(false);
    }
  }

  const displayMoveError = moveError ?? moveFailedMessage;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <PageHeader backHref="/week" color="var(--crema)" />
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Link href={`/session/${index}/edit`} className="tap-target" aria-label="Modifica allenamento" style={{ color: "var(--crema)", fontSize: 18, textDecoration: "none" }}>
            ✎
          </Link>
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
      </div>

      {confirmDelete && (
        <div style={{ alignSelf: "stretch", background: "rgba(246,238,218,.1)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <p style={{ fontSize: 13, margin: 0, flex: 1 }}>Eliminare questo allenamento dal piano e dal calendario Garmin?</p>
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
        <p style={{ color: "var(--rosso-avviso)", fontSize: 13, marginTop: 10, alignSelf: "stretch" }} role="alert">
          {deleteError}
        </p>
      )}

      <ProgressRing value={Math.min(1, distanceKm / 20)} size={180} strokeWidth={12} trackColor="rgba(246,238,218,.13)">
        <div style={{ textAlign: "center" }}>
          <p className="font-mono" style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>{distanceKm.toFixed(1)}</p>
          <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: 0 }}>km totali</p>
        </div>
      </ProgressRing>

      <WordIn active={animate} delayMs={200} style={{ font: "600 26px/1.06 var(--font-outfit)", textAlign: "center", marginTop: 20 }}>
        {session.title}
      </WordIn>
      {session.description && (
        <p className="font-serif-italic" style={{ fontSize: 15.5, textAlign: "center", color: "var(--inchiostro-su-scuro)", maxWidth: 280 }}>
          {session.description}
        </p>
      )}

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        {groups.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--inchiostro-su-scuro)", fontSize: 13 }}>Sessione libera, senza step strutturati.</p>
        )}
        {groups.map((group, i) => {
          const isKey = group.kind === "interval";
          const { label, detail } = stepGroupParts(group);
          const km = group.reps * stepDistanceKm(group.step) + (group.recovery ? group.reps * stepDistanceKm(group.recovery) : 0);
          return (
            <div
              key={i}
              style={{
                background: isKey ? "var(--corallo)" : "rgba(246,238,218,.07)",
                color: isKey ? "var(--corallo-testo)" : "var(--crema)",
                borderRadius: "var(--radius-row)",
                padding: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 10,
              }}
              className={isKey ? "anim-breath" : undefined}
            >
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</span>
                {detail && (
                  <span className="font-mono" style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>{detail}</span>
                )}
              </span>
              {km > 0 && (
                <span className="font-mono" style={{ fontSize: 12, flex: "none" }}>{km.toFixed(1).replace(".", ",")} km</span>
              )}
            </div>
          );
        })}
      </div>

      {hasStravaMatch && matchQuery.data && (
        <Link href={`/session/${index}/strava`} style={{ textDecoration: "none", color: "inherit", width: "100%" }}>
          <div style={{ width: "100%", boxSizing: "border-box", background: "rgba(246,238,218,.09)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Svolta, da Strava</p>
              <p className="font-mono" style={{ fontSize: 13, margin: "3px 0 0" }}>
                {matchQuery.data.distance_km != null ? `${matchQuery.data.distance_km.toFixed(1)} km` : "—"}
                {matchQuery.data.avg_pace_sec_per_km != null && ` · ${formatPaceValue(matchQuery.data.avg_pace_sec_per_km)}`}
              </p>
              <p className="font-serif-italic" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)", margin: "3px 0 0" }}>
                Confronta pianificato e svolto
              </p>
            </div>
            <span aria-hidden="true">›</span>
          </div>
        </Link>
      )}

      <div style={{ width: "100%", marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <PrimaryButton background="var(--verde)" textColor="var(--verde-testo)" fillColor="var(--verde)" successColor="var(--verde)">
          Già sul calendario
        </PrimaryButton>
        <button
          type="button"
          onClick={moveToTomorrow}
          disabled={isMoving}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-su-scuro)", fontSize: 13, cursor: isMoving ? "default" : "pointer" }}
        >
          {isMoving ? "Sposto…" : `Sposta a ${formatWeekday(nextDayKey())}`}
        </button>
        {displayMoveError && (
          <p style={{ color: "var(--rosso-avviso)", fontSize: 13, textAlign: "center" }} role="alert">
            {displayMoveError}
          </p>
        )}
      </div>
    </div>
  );
}
