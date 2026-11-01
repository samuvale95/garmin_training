"use client";

import { dis } from "@/lib/disabled";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  useStravaActivityMatch,
  useStravaStatus,
  useWorkoutsForDate,
} from "@/lib/queries";
import { normalizeTitle } from "@/lib/sessionVisuals";
import { useScreenReady } from "@/lib/useScreenReady";
import { useMoveSession } from "@/lib/moveWarnings";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { plan, isHydrated } = useRequirePlan();
  useScreenReady(isHydrated);
  const animate = useMountOnce(`session-${params.id}`);
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
  // needed to delete it there too. A move is saved in the plan and reaches Garmin
  // through the reviewed "modifiche da inviare" step, like a move in the calendar. Absent for a session that only exists in the local plan so far.
  // Read out of that day's cached *week*, which Oggi/Settimana already loaded: asking
  // for the single day would be a guaranteed cache miss and a fresh Garmin round-trip.
  const workoutsQuery = useWorkoutsForDate(session?.date ?? "", !!session);
  const originalWorkout = session
    ? workoutsQuery.workouts.find((w) => normalizeTitle(w.title) === normalizeTitle(session.title))
    : undefined;

  const moveSession = useMoveSession();
  const applyDeletion = useApplyDeletion();

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
      <DetailScaffold backHref="/week">
        <div className="empty" style={{ marginTop: 16 }}>
          <h2>Seduta non trovata</h2>
          <p>Potrebbe essere stata spostata o eliminata. Il calendario mostra il piano aggiornato.</p>
          <div className="actions"><Link className="btn" href="/week" data-track="session.not-found">Apri il calendario</Link></div>
        </div>
      </DetailScaffold>
    );
  }

  const currentSession = session; // narrows the closures below to non-null, once

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

  return (
    <DetailScaffold
      backHref="/week"
      error={deleteError}
      actions={
        <>
          <Link data-track="session.id.modifica-allenamento" href={`/session/${sessionId}/edit`} className="icon-btn" aria-label="Modifica allenamento">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
        <>
          <Link className="btn" data-variant="primary" href={`/session/${sessionId}/edit`} data-track="session.edit" style={{ flex: 1 }}>
            Modifica
          </Link>
          <MoveControl
            date={currentSession.date}
            busy={false}
            onMove={(date) => {
              moveSession(sessionId, currentSession.date, date);
              router.push(`/week?date=${date}`);
            }}
          />
        </>
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

/** "Sposta": a visible command with a date, not only a drag in the calendar. The change
 * is saved in the app; sending it to Garmin stays a separate, previewed step. */
function MoveControl({ date, busy, onMove }: { date: string; busy: boolean; onMove: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(date);
  if (!open) {
    return (
      <button type="button" className="btn" style={{ flex: 1 }} data-track="session.move-open" onClick={() => setOpen(true)}>
        Sposta
      </button>
    );
  }
  return (
    <form
      style={{ flex: 2, display: "flex", gap: 8, alignItems: "flex-end" }}
      onSubmit={(event) => {
        event.preventDefault();
        if (busy || !target || target === date) return;
        onMove(target);
      }}
    >
      <label className="field" style={{ flex: 1 }}>
        <span className="sr-only">Nuovo giorno</span>
        <input type="date" value={target} required onChange={(e) => setTarget(e.target.value)} data-track="session.move-date" />
      </label>
      <button type="submit" className="btn" data-variant="accent" data-track="session.move-confirm" {...dis(busy || target === date, busy ? "in_caricamento" : "scegli_un_altro_giorno")}>
        Sposta
      </button>
      <button type="button" className="btn" data-variant="quiet" aria-label="Annulla spostamento" data-track="session.move-cancel" onClick={() => setOpen(false)}>
        ✕
      </button>
    </form>
  );
}
