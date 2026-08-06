"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Reorder } from "framer-motion";
import { PrimaryButton, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useAddSession, useApplyDeletion, useInvalidateCalendarData, usePlanQuery, useRemoveSession, useStartSync, useSyncJobStatus, useUpdateSession, useWorkoutsForDate } from "@/lib/queries";
import { ApiError } from "@/lib/apiClient";
import { normalizeTitle, toDateKey } from "@/lib/sessionVisuals";
import { stepTypeLabel } from "@/lib/format";
import type { ScheduledWorkout, Sport, Step, TrainingSession } from "@/lib/types";

const SPORT_CHIPS: { value: Sport; label: string }[] = [
  { value: "running", label: "Corsa" },
  { value: "cycling", label: "Bici" },
  { value: "strength_training", label: "Forza" },
  { value: "swimming", label: "Nuoto" },
  { value: "other", label: "Riposo" },
];

// Rest days have no dedicated sport in the file format (training_plan.models.SUPPORTED_SPORTS
// has no "rest" value) -- the "Riposo" chip is stored as sport "other", same fallback the
// week screen already treats as a rest-like day when there is no session at all.
const STEP_TYPES: Step["type"][] = ["warmup", "interval", "recovery", "cooldown"];

let stepIdCounter = 0;
function newStepId(): string {
  stepIdCounter += 1;
  return `step-${stepIdCounter}`;
}

type EditableStep = Step & { _id: string };

function stepSummary(step: Step): string {
  const duration = step.duration_type === "distance" ? `${step.duration_value} km` : `${step.duration_value} min`;
  const pace = step.target_pace ? ` · ${step.target_pace.slower_sec_per_km}-${step.target_pace.faster_sec_per_km}s/km` : "";
  return `${duration}${pace}`;
}

/** The three things this form can be editing.
 *
 * `edit` is a session of the *local plan*, which may or may not also exist on the Garmin
 * calendar (found by (date, title) below). `garmin` is the opposite case: a workout that
 * only ever existed on the calendar -- opened from `/workout/[id]`, with no plan behind
 * it -- whose identity is already known, and whose contents Garmin itself supplied. The
 * local plan is left untouched in that mode: this workout is not part of it. */
type WorkoutEditorProps =
  | { mode: "create" }
  | { mode: "edit"; sessionIndex: number }
  | { mode: "garmin"; workout: ScheduledWorkout; session: TrainingSession };

export function WorkoutEditor(props: WorkoutEditorProps) {
  const { mode } = props;
  const sessionIndex = props.mode === "edit" ? props.sessionIndex : null;
  const garminWorkout = props.mode === "garmin" ? props.workout : null;
  const garminSession = props.mode === "garmin" ? props.session : null;

  const router = useRouter();
  const animate = useMountOnce(
    mode === "edit"
      ? `session-edit-${sessionIndex}`
      : mode === "garmin"
        ? `workout-edit-${garminWorkout!.scheduled_workout_id}`
        : "session-new"
  );
  // No `useRequirePlan()` here, deliberately: create mode must work with no plan at
  // all (the whole point of "+" from Settimana is to start one from scratch) --
  // `addSession` below lazily creates an empty plan the first time it's called.
  const { data: plan } = usePlanQuery();
  const updateSession = useUpdateSession();
  const addSession = useAddSession();
  const removeSession = useRemoveSession();
  const invalidateCalendar = useInvalidateCalendarData();

  const existing =
    mode === "edit" ? (plan && sessionIndex != null ? plan.sessions[sessionIndex] : null) : garminSession;
  // Captured once, at mount: the (date, title) Garmin actually knows this session by,
  // so editing the title/date in this form doesn't break the calendar lookup below.
  // Only needed in `edit` mode -- in `garmin` mode the calendar entry is handed in.
  const [originalKey] = useState(() =>
    mode === "edit" && existing ? { date: existing.date, title: existing.title } : null
  );

  const [date, setDate] = useState(existing?.date ?? toDateKey(new Date()));
  const [sport, setSport] = useState<Sport>((existing?.sport as Sport) ?? "running");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [steps, setSteps] = useState<EditableStep[]>(() => (existing?.steps ?? []).map((s) => ({ ...s, _id: newStepId() })));
  const [editingStep, setEditingStep] = useState<EditableStep | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  /** Where "×"/"Annulla" go back to: the screen this editor was opened from. */
  const originHref =
    mode === "edit"
      ? `/session/${sessionIndex}`
      : mode === "garmin"
        ? `/workout/${garminWorkout!.scheduled_workout_id}?date=${garminWorkout!.date}`
        : "/week";
  /** Where a *successful* save lands. Not `originHref` in `garmin` mode: a replace on
   * Garmin is a delete plus a create (see `GarminSync.replace_session`), so the id in
   * that route no longer exists once the job is done. */
  const successHref = mode === "garmin" ? "/week" : originHref;

  // Read out of the cached week the editor was opened from, so this lookup is normally
  // already answered by the time the form appears.
  const workoutsQuery = useWorkoutsForDate(originalKey?.date ?? "", mode === "edit" && !!originalKey);
  const originalWorkout: ScheduledWorkout | undefined =
    garminWorkout ??
    (originalKey
      ? workoutsQuery.workouts.find((w) => normalizeTitle(w.title) === normalizeTitle(originalKey.title))
      : undefined);
  /** Whether we yet know if this session already exists on the Garmin calendar.
   *
   * This gates saving, and it must: `handleSave` picks "replace the existing workout" vs
   * "create a new one" from `originalWorkout`, so saving before the lookup resolved took
   * the create branch and left a *duplicate* workout on the calendar. Never in doubt in
   * `garmin` mode, where the calendar entry is what the editor was opened on. */
  const calendarIdentityKnown = mode !== "edit" || !originalKey || workoutsQuery.isSuccess;

  const startSync = useStartSync();
  const syncStatus = useSyncJobStatus(jobId);
  const applyDeletion = useApplyDeletion();

  // Job outcome is derived at render time, not written into state from an effect --
  // the query's own polling (`useSyncJobStatus`) is already the single source of
  // truth for job progress, so there is nothing here to synchronize into local state.
  const jobItem = syncStatus.data?.items[0];
  const jobFailedMessage =
    syncStatus.data?.status === "failed"
      ? syncStatus.data.failure ?? "Scrittura su Garmin non riuscita. Riprova."
      : syncStatus.data?.status === "done" && jobItem?.status === "failed"
        ? jobItem.error ?? "Scrittura su Garmin non riuscita. Riprova."
        : null;
  const jobSucceeded = syncStatus.data?.status === "done" && jobItem?.status !== "failed";

  // Navigation is the one genuine side effect here (not React state), so it stays in
  // an effect: once the job settles successfully, leave for the origin screen. The
  // calendar it just wrote to is dropped from the client cache on the way out --
  // otherwise the week we land on would keep showing the pre-edit workout for the rest
  // of its stale time (the backend has already dropped its own copy, see `jobs.py`).
  useEffect(() => {
    if (jobId && jobSucceeded) {
      invalidateCalendar();
      router.push(successHref);
    }
  }, [jobId, jobSucceeded, successHref, router, invalidateCalendar]);

  if (mode === "edit" && (!plan || !existing)) {
    return (
      <div style={{ padding: 22 }}>
        <p>Sessione non trovata.</p>
      </div>
    );
  }

  const displayError = saveError ?? jobFailedMessage;
  const isSaving = startSync.isPending || (!!jobId && !jobFailedMessage && !jobSucceeded);

  function plainSteps(): Step[] {
    return steps.map((s) => ({ type: s.type, duration_type: s.duration_type, duration_value: s.duration_value, target_pace: s.target_pace }));
  }

  async function handleSave() {
    setSaveError(null);
    const session: TrainingSession = {
      date,
      sport,
      title: title.trim() || "Allenamento",
      description: description.trim() || null,
      steps: plainSteps(),
    };

    // `garmin` mode edits a workout that isn't in the local plan at all, so it writes
    // nothing there -- the calendar is the only place this session lives.
    if (mode === "create") {
      addSession(session);
    } else if (mode === "edit") {
      updateSession(sessionIndex!, () => session);
    }

    try {
      const payload = originalWorkout
        ? {
            to_create: [],
            changed: [
              {
                session,
                scheduled_workout_id: originalWorkout.scheduled_workout_id,
                workout_id: originalWorkout.workout_id,
                workout_date: originalWorkout.date,
                workout_sport: originalWorkout.sport,
                workout_title: originalWorkout.title,
              },
            ],
          }
        : { to_create: [session], changed: [] };
      const { job_id } = await startSync.mutateAsync(payload);
      setJobId(job_id);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Qualcosa non ha funzionato. Riprova.");
    }
  }

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaveError(null);
    try {
      if (originalWorkout) {
        await applyDeletion.mutateAsync([originalWorkout]);
      }
      if (mode === "edit") removeSession(sessionIndex!);
      router.push("/week");
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Non sono riuscito a cancellare l'allenamento.");
    }
  }

  function addStep() {
    setSteps((prev) => [...prev, { _id: newStepId(), type: "interval", duration_type: "distance", duration_value: 1 }]);
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--crema)", padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" onClick={() => router.push(originHref)} className="tap-target" aria-label="Chiudi" style={{ background: "none", border: "none", fontSize: 22, color: "var(--inchiostro)", cursor: "pointer" }}>
          ×
        </button>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="font-mono"
          style={{ border: "none", background: "none", fontSize: 13, color: "var(--inchiostro-50)", textAlign: "center" }}
        />
        {mode !== "create" ? (
          <button
            type="button"
            onClick={handleDelete}
            className="tap-target"
            aria-label="Elimina allenamento"
            style={{ background: "none", border: "none", fontSize: 18, color: "var(--rosso-avviso)", cursor: "pointer" }}
          >
            🗑
          </button>
        ) : (
          <span style={{ width: 24 }} />
        )}
      </div>

      {confirmDelete && (
        <div style={{ background: "var(--rosa-avviso)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <p style={{ fontSize: 13, color: "var(--rosso-testo)", margin: 0, flex: 1 }}>
            {mode === "garmin"
              ? "Eliminare questo allenamento dal calendario Garmin?"
              : "Eliminare questo allenamento dal piano e dal calendario Garmin?"}
          </p>
          <button type="button" onClick={handleDelete} className="tap-target" style={{ background: "var(--rosso-forte)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
            Elimina
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="tap-target" style={{ background: "none", border: "none", fontSize: 12, color: "var(--inchiostro-50)", cursor: "pointer" }}>
            Annulla
          </button>
        </div>
      )}

      <WordIn active={animate} style={{ font: "600 30px/1.06 var(--font-outfit)", letterSpacing: "-.03em", marginTop: 18 }}>
        {mode === "create" ? "Crea allenamento" : "Modifica allenamento"}
      </WordIn>

      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        {SPORT_CHIPS.map((chip) => {
          const selected = sport === chip.value;
          return (
            <button
              key={chip.value}
              type="button"
              onClick={() => setSport(chip.value)}
              className="tap-target"
              style={{
                border: "none",
                borderRadius: "var(--radius-pill)",
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                background: selected ? "var(--corallo)" : "var(--sabbia-chip)",
                color: selected ? "var(--corallo-testo)" : "var(--inchiostro-70)",
              }}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 18 }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--inchiostro-50)", marginBottom: 8 }}>
          Titolo
        </span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome dell'allenamento"
          style={{ width: "100%", border: "none", borderBottom: "1.5px solid var(--sabbia-bordo)", background: "transparent", fontSize: 17, fontWeight: 600, padding: "4px 0 8px", outline: "none" }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 20 }}>
        <span style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>Struttura</span>
        <button type="button" onClick={addStep} className="tap-target" style={{ background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
          + step
        </button>
      </div>

      <Reorder.Group axis="y" values={steps} onReorder={setSteps} style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((step) => {
          const isKey = step.type === "interval";
          return (
            <Reorder.Item
              key={step._id}
              value={step}
              style={{
                background: isKey ? "var(--corallo)" : "var(--crema-card)",
                color: isKey ? "var(--corallo-testo)" : "var(--inchiostro)",
                borderRadius: "var(--radius-row)",
                padding: "12px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "grab",
              }}
            >
              <span aria-hidden="true" style={{ opacity: 0.5, fontSize: 14 }}>⠿</span>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{stepTypeLabel(step.type)}</span>
                <span className="font-mono" style={{ display: "block", fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>{stepSummary(step)}</span>
              </span>
              <button
                type="button"
                onClick={() => setEditingStep(step)}
                className="tap-target"
                aria-label="Modifica step"
                style={{ background: "none", border: "none", fontSize: 14, color: "inherit", opacity: 0.7, cursor: "pointer" }}
              >
                ✎
              </button>
            </Reorder.Item>
          );
        })}
        {steps.length === 0 && (
          <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-50)", padding: "6px 2px" }}>
            Nessuno step. Aggiungine uno con &quot;+ step&quot;.
          </p>
        )}
      </Reorder.Group>

      <div style={{ marginTop: 20 }}>
        <span style={{ display: "block", fontSize: 11, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--inchiostro-50)", marginBottom: 8 }}>
          Note libere
        </span>
        <textarea
          value={description ?? ""}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Note per questa seduta..."
          rows={3}
          className="font-serif-italic"
          style={{ width: "100%", border: "none", background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, fontSize: 14, resize: "vertical", outline: "none", boxSizing: "border-box" }}
        />
      </div>

      {displayError && (
        <p style={{ color: "var(--rosso-forte)", fontSize: 13, marginTop: 16 }} role="alert">
          {displayError}
        </p>
      )}

      <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <PrimaryButton
          state={isSaving || !calendarIdentityKnown ? "loading" : "idle"}
          onClick={handleSave}
        >
          {calendarIdentityKnown ? "Salva sul calendario" : "Leggo il calendario…"}
        </PrimaryButton>
        <button
          type="button"
          onClick={() => router.push(originHref)}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-50)", fontSize: 13, cursor: "pointer" }}
        >
          Annulla
        </button>
      </div>

      {editingStep && (
        <StepEditorModal
          step={editingStep}
          onCancel={() => setEditingStep(null)}
          onSave={(updated) => {
            setSteps((prev) => prev.map((s) => (s._id === updated._id ? updated : s)));
            setEditingStep(null);
          }}
        />
      )}
    </div>
  );
}

function StepEditorModal({ step, onSave, onCancel }: { step: EditableStep; onSave: (step: EditableStep) => void; onCancel: () => void }) {
  const [type, setType] = useState<Step["type"]>(step.type);
  const [durationType, setDurationType] = useState<Step["duration_type"]>(step.duration_type);
  const [durationValue, setDurationValue] = useState(step.duration_value);
  const [hasPace, setHasPace] = useState(!!step.target_pace);
  const [slower, setSlower] = useState(step.target_pace?.slower_sec_per_km ?? 300);
  const [faster, setFaster] = useState(step.target_pace?.faster_sec_per_km ?? 280);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,26,22,.45)", display: "flex", alignItems: "flex-end", zIndex: 20 }} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", background: "var(--crema)", borderRadius: "22px 22px 0 0", padding: "22px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <p style={{ font: "600 18px var(--font-outfit)", margin: 0 }}>Modifica step</p>

        <Field label="Tipo">
          <select value={type} onChange={(e) => setType(e.target.value as Step["type"])} style={selectStyle}>
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {stepTypeLabel(t)}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Durata">
          <div style={{ display: "flex", gap: 8 }}>
            <select value={durationType} onChange={(e) => setDurationType(e.target.value as Step["duration_type"])} style={{ ...selectStyle, flex: 1 }}>
              <option value="distance">distanza (km)</option>
              <option value="time">tempo (min)</option>
            </select>
            <input
              type="number"
              value={durationValue}
              onChange={(e) => setDurationValue(Number(e.target.value))}
              style={{ ...selectStyle, width: 90 }}
            />
          </div>
        </Field>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          <input type="checkbox" checked={hasPace} onChange={(e) => setHasPace(e.target.checked)} />
          Passo target
        </label>
        {hasPace && (
          <Field label="Passo (sec/km, più lento - più veloce)">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="number" value={slower} onChange={(e) => setSlower(Number(e.target.value))} style={{ ...selectStyle, flex: 1 }} />
              <span>–</span>
              <input type="number" value={faster} onChange={(e) => setFaster(Number(e.target.value))} style={{ ...selectStyle, flex: 1 }} />
            </div>
          </Field>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button
            type="button"
            onClick={() =>
              onSave({
                ...step,
                type,
                duration_type: durationType,
                duration_value: durationValue,
                target_pace: hasPace ? { slower_sec_per_km: slower, faster_sec_per_km: faster } : null,
              })
            }
            className="tap-target"
            style={{ flex: 1, background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Fatto
          </button>
          <button type="button" onClick={onCancel} className="tap-target" style={{ flex: 1, background: "var(--sabbia-chip)", border: "none", borderRadius: "var(--radius-pill)", padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            Annulla
          </button>
        </div>
      </div>
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: "100%",
  border: "1.5px solid var(--sabbia-bordo)",
  borderRadius: 10,
  background: "var(--crema-card)",
  fontSize: 14,
  padding: "8px 10px",
  outline: "none",
  boxSizing: "border-box",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "var(--inchiostro-50)", marginBottom: 6 }}>{label}</span>
      {children}
    </label>
  );
}
