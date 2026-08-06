"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Reorder } from "framer-motion";
import { PrimaryButton, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useAddSession, useApplyDeletion, useInvalidateCalendarData, usePlanQuery, useRemoveSession, useStartSync, useSyncJobStatus, useUpdateSession, useWorkoutsForDate } from "@/lib/queries";
import { ApiError } from "@/lib/apiClient";
import { normalizeTitle, parseDateKey, shiftDateKey, toDateKey } from "@/lib/sessionVisuals";
import { capitalize, formatFullDate, formatPaceMinSec, formatPaceRange, parsePaceMinSec, stepTypeHint, stepTypeLabel } from "@/lib/format";
import { isRepeatBlock } from "@/lib/types";
import type { ScheduledWorkout, SessionStep, Sport, Step, StepType, TrainingSession } from "@/lib/types";

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
const STEP_TYPES: StepType[] = ["warmup", "interval", "recovery", "rest", "cooldown"];

// Garmin's own bounds on a repeat group; the file format enforces the same range
// (training_plan.models.MIN_REPETITIONS/MAX_REPETITIONS).
const MIN_REPS = 2;
const MAX_REPS = 99;

let stepIdCounter = 0;
function newStepId(): string {
  stepIdCounter += 1;
  return `step-${stepIdCounter}`;
}

/** The editor's working copy of a session's steps.
 *
 * Everything the list renders carries an `_id`, including the blocks themselves, so
 * dragging and per-row edits address a stable identity rather than a position that
 * shifts under them. Stripped back out by `plainSteps` on save. */
type EditableStep = Step & { _id: string };
type EditableBlock = { _id: string; reps: number; steps: EditableStep[] };
type EditableItem = EditableStep | EditableBlock;

function isEditableBlock(item: EditableItem): item is EditableBlock {
  return "reps" in item;
}

function toEditable(items: SessionStep[]): EditableItem[] {
  return items.map((item) =>
    isRepeatBlock(item)
      ? { _id: newStepId(), reps: item.reps, steps: item.steps.map((s) => ({ ...s, _id: newStepId() })) }
      : { ...item, _id: newStepId() }
  );
}

function stepSummary(step: Step): string {
  const duration = step.duration_type === "distance" ? `${step.duration_value} km` : `${step.duration_value} min`;
  const pace = step.target_pace ? ` · ${formatPaceRange(step.target_pace)}/km` : "";
  return `${duration}${pace}`;
}

/** A new step's starting point, by type. A recovery is born with a slow pace target
 * on purpose: a recovery step with no target is what turns "due minuti di corsa
 * lenta" into two minutes of standing around on the watch. */
function blankStep(type: StepType): EditableStep {
  if (type === "recovery") {
    return {
      _id: newStepId(),
      type,
      duration_type: "time",
      duration_value: 2,
      target_pace: { slower_sec_per_km: 420, faster_sec_per_km: 360 },
    };
  }
  if (type === "rest") {
    return { _id: newStepId(), type, duration_type: "time", duration_value: 2 };
  }
  if (type === "warmup" || type === "cooldown") {
    return { _id: newStepId(), type, duration_type: "time", duration_value: 10 };
  }
  return { _id: newStepId(), type, duration_type: "distance", duration_value: 1 };
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
  /** The day this workout is scheduled on *now*, before anything typed in this form --
   * null in create mode, where there is nothing to move.
   *
   * Editing the day is a move, not a content edit: Garmin schedules a workout on a date,
   * so saving a different one has to delete the old calendar entry and re-schedule it
   * (`GarminSync.replace_session`), which is exactly what the `changed` branch of
   * `handleSave` already asks for. Nothing extra is needed on the wire -- only that the
   * identity below keeps pointing at the *old* day while the form holds the new one. */
  const originalDate = mode === "garmin" ? garminWorkout!.date : originalKey?.date ?? null;

  const [date, setDate] = useState(existing?.date ?? toDateKey(new Date()));
  const [sport, setSport] = useState<Sport>((existing?.sport as Sport) ?? "running");
  const [title, setTitle] = useState(existing?.title ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [steps, setSteps] = useState<EditableItem[]>(() => toEditable(existing?.steps ?? []));
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
   * that route no longer exists once the job is done.
   *
   * The day travels along, because it may not be the day we came from: a workout moved
   * to another week would otherwise land on *this* week, where it is now correctly
   * absent -- indistinguishable, on screen, from having deleted it. */
  const successHref = mode === "edit" ? originHref : `/week?date=${date}`;

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
  // A date field can be cleared, and an empty (or half-typed) day would reach the API as
  // an unparseable date and come back a 422 -- so it gates the save instead.
  const dayIsValid = parseDateKey(date) !== null;
  const movedFrom = originalDate && dayIsValid && date !== originalDate ? originalDate : null;

  function plainSteps(): SessionStep[] {
    const strip = (s: EditableStep): Step => ({
      type: s.type,
      duration_type: s.duration_type,
      duration_value: s.duration_value,
      target_pace: s.target_pace,
    });
    return steps.flatMap((item): SessionStep[] => {
      if (!isEditableBlock(item)) return [strip(item)];
      // An emptied block would be rejected by the backend, and a block is only a block
      // from two repetitions up -- below that, hand its steps over on their own.
      if (item.steps.length === 0) return [];
      if (item.reps < MIN_REPS) return item.steps.map(strip);
      return [{ reps: item.reps, steps: item.steps.map(strip) }];
    });
  }

  async function handleSave() {
    if (!dayIsValid) return;
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
    setSteps((prev) => [...prev, blankStep("interval")]);
  }

  /** A repeat block starts as the shape it is almost always used for: a work step plus
   * a jogged recovery, four times over. */
  function addBlock() {
    setSteps((prev) => [
      ...prev,
      { _id: newStepId(), reps: 4, steps: [blankStep("interval"), blankStep("recovery")] },
    ]);
  }

  function setBlockReps(blockId: string, reps: number) {
    setSteps((prev) =>
      prev.map((item) =>
        isEditableBlock(item) && item._id === blockId
          ? { ...item, reps: Math.min(MAX_REPS, Math.max(MIN_REPS, reps)) }
          : item
      )
    );
  }

  function addStepToBlock(blockId: string) {
    setSteps((prev) =>
      prev.map((item) =>
        isEditableBlock(item) && item._id === blockId
          ? { ...item, steps: [...item.steps, blankStep("interval")] }
          : item
      )
    );
  }

  /** Removes a step wherever it sits -- top level or inside a block -- and takes an
   * emptied block with it, so the list can never hold a "0 ×" row. */
  function removeStep(stepId: string) {
    setSteps((prev) =>
      prev
        .map((item) =>
          isEditableBlock(item) ? { ...item, steps: item.steps.filter((s) => s._id !== stepId) } : item
        )
        .filter((item) => (isEditableBlock(item) ? item.steps.length > 0 : item._id !== stepId))
    );
  }

  function removeBlock(blockId: string) {
    setSteps((prev) => prev.filter((item) => item._id !== blockId));
  }

  function replaceStep(updated: EditableStep) {
    setSteps((prev) =>
      prev.map((item) => {
        if (isEditableBlock(item)) {
          return { ...item, steps: item.steps.map((s) => (s._id === updated._id ? updated : s)) };
        }
        return item._id === updated._id ? updated : item;
      })
    );
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--crema)", padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <button type="button" onClick={() => router.push(originHref)} className="tap-target" aria-label="Chiudi" style={{ background: "none", border: "none", fontSize: 22, color: "var(--inchiostro)", cursor: "pointer" }}>
          ×
        </button>
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

      <DayField
        value={date}
        onChange={setDate}
        isValid={dayIsValid}
        movedFrom={movedFrom}
        // In `garmin` mode there is no local plan behind this workout: the calendar is
        // the only place the move happens, and saying so is the whole point of the
        // screen the user reached from "dal calendario Garmin".
        onlyOnGarmin={mode === "garmin"}
      />

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14 }}>
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
        <span style={{ display: "flex", gap: 14 }}>
          <button type="button" onClick={addBlock} className="tap-target" style={{ background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + blocco
          </button>
          <button type="button" onClick={addStep} className="tap-target" style={{ background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + step
          </button>
        </span>
      </div>

      {/* Only the top level is draggable. A block's own steps are reordered by
          rebuilding the block (delete + add), which keeps the drag handling to one
          `Reorder.Group` instead of nesting one inside another. */}
      <Reorder.Group axis="y" values={steps} onReorder={setSteps} style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((item) =>
          isEditableBlock(item) ? (
            <Reorder.Item
              key={item._id}
              value={item}
              style={{
                background: "var(--sabbia-chip)",
                borderRadius: "var(--radius-row)",
                padding: "12px 12px 14px",
                cursor: "grab",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span aria-hidden="true" style={{ opacity: 0.5, fontSize: 14 }}>⠿</span>
                <span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>Ripeti</span>
                <RepsStepper reps={item.reps} onChange={(reps) => setBlockReps(item._id, reps)} />
                <button
                  type="button"
                  onClick={() => removeBlock(item._id)}
                  className="tap-target"
                  aria-label="Elimina blocco"
                  style={{ background: "none", border: "none", fontSize: 14, color: "var(--inchiostro-50)", cursor: "pointer" }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10, paddingLeft: 12, borderLeft: "2px solid var(--sabbia-bordo)" }}>
                {item.steps.map((step) => (
                  <StepRow key={step._id} step={step} onEdit={() => setEditingStep(step)} onRemove={() => removeStep(step._id)} />
                ))}
                <button
                  type="button"
                  onClick={() => addStepToBlock(item._id)}
                  className="tap-target"
                  style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--rosso-avviso)", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 0" }}
                >
                  + step nel blocco
                </button>
              </div>
            </Reorder.Item>
          ) : (
            <Reorder.Item key={item._id} value={item} style={{ cursor: "grab" }}>
              <StepRow step={item} draggable onEdit={() => setEditingStep(item)} onRemove={() => removeStep(item._id)} />
            </Reorder.Item>
          )
        )}
        {steps.length === 0 && (
          <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-50)", padding: "6px 2px" }}>
            Nessuno step. Aggiungi uno step singolo, o un blocco da ripetere.
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
          state={!dayIsValid ? "disabled" : isSaving || !calendarIdentityKnown ? "loading" : "idle"}
          onClick={handleSave}
        >
          {!dayIsValid
            ? "Scegli un giorno"
            : !calendarIdentityKnown
              ? "Leggo il calendario…"
              : movedFrom
                ? "Sposta sul calendario"
                : "Salva sul calendario"}
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
            replaceStep(updated);
            setEditingStep(null);
          }}
        />
      )}
    </div>
  );
}

/** The day the workout is scheduled on -- a field of its own, not a caption.
 *
 * It used to be a bare `<input type="date">` in the header, styled down to 13px grey to
 * sit next to the close and delete icons: on a phone that reads as the screen's date
 * label, not as something you can change. Which day a session falls on is one of the
 * things most often edited (a workout postponed by a day), and on a workout that lives
 * only on Garmin -- with no plan file to re-import -- this field is the *only* way to
 * move it, so it gets the same weight as the title.
 *
 * Both ways in, because they answer different questions: the arrows for "one day later",
 * the field itself for "which Thursday" -- tapping anywhere on the date opens the
 * platform's own date picker, which is why the native input is still here, stretched
 * invisibly over the formatted text rather than replaced by a custom calendar. */
function DayField({
  value,
  onChange,
  isValid,
  movedFrom,
  onlyOnGarmin,
}: {
  value: string;
  onChange: (value: string) => void;
  isValid: boolean;
  movedFrom: string | null;
  onlyOnGarmin: boolean;
}) {
  const nudge = (delta: number, label: string) => (
    <button
      type="button"
      onClick={() => onChange(shiftDateKey(value, delta))}
      disabled={!isValid}
      className="tap-target"
      aria-label={label}
      style={{
        background: "var(--sabbia-chip)",
        border: "none",
        borderRadius: "var(--radius-pill)",
        width: 32,
        height: 32,
        flex: "none",
        fontSize: 16,
        lineHeight: 1,
        color: "var(--inchiostro)",
        cursor: isValid ? "pointer" : "not-allowed",
        opacity: isValid ? 1 : 0.35,
      }}
    >
      {delta > 0 ? "›" : "‹"}
    </button>
  );

  return (
    <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 18 }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--inchiostro-50)", marginBottom: 8 }}>
        Giorno
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {nudge(-1, "Un giorno prima")}
        <label style={{ position: "relative", flex: 1, display: "block", textAlign: "center", cursor: "pointer" }}>
          <span style={{ fontSize: 17, fontWeight: 600, color: isValid ? "var(--inchiostro)" : "var(--inchiostro-50)" }}>
            {isValid ? capitalize(formatFullDate(value)) : "Scegli un giorno"}
          </span>
          {/* Laid over the text, not next to it: the whole date is the tap target, and
              the native picker is what actually opens. `opacity: 0` rather than
              `visibility/display: none`, which would take the picker with it. */}
          <input
            type="date"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Giorno dell'allenamento"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              border: "none",
              background: "transparent",
              WebkitAppearance: "none",
              appearance: "none",
              cursor: "pointer",
            }}
          />
        </label>
        {nudge(1, "Un giorno dopo")}
      </div>
      {movedFrom && (
        <p className="font-serif-italic" style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "10px 0 0", textAlign: "center" }}>
          Era {formatFullDate(movedFrom)}. Salvando, l&apos;allenamento si sposta
          {onlyOnGarmin ? " sul calendario Garmin." : " anche sul calendario Garmin."}
        </p>
      )}
    </div>
  );
}

/** One step row, identical whether it sits at the top level or inside a block -- the
 * drag handle is the only difference, since a block's steps don't drag. */
function StepRow({
  step,
  draggable = false,
  onEdit,
  onRemove,
}: {
  step: EditableStep;
  draggable?: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const isKey = step.type === "interval";
  return (
    <div
      style={{
        background: isKey ? "var(--corallo)" : "var(--crema-card)",
        color: isKey ? "var(--corallo-testo)" : "var(--inchiostro)",
        borderRadius: "var(--radius-row)",
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {draggable && <span aria-hidden="true" style={{ opacity: 0.5, fontSize: 14 }}>⠿</span>}
      <span style={{ flex: 1 }}>
        <span style={{ display: "block", fontSize: 13.5, fontWeight: 600 }}>{stepTypeLabel(step.type)}</span>
        <span className="font-mono" style={{ display: "block", fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>{stepSummary(step)}</span>
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="tap-target"
        aria-label={`Modifica ${stepTypeLabel(step.type).toLowerCase()}`}
        style={{ background: "none", border: "none", fontSize: 14, color: "inherit", opacity: 0.7, cursor: "pointer" }}
      >
        ✎
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="tap-target"
        aria-label={`Elimina ${stepTypeLabel(step.type).toLowerCase()}`}
        style={{ background: "none", border: "none", fontSize: 14, color: "inherit", opacity: 0.55, cursor: "pointer" }}
      >
        ✕
      </button>
    </div>
  );
}

/** "− 4 × +". A stepper rather than a number field: reps are single digits in
 * practice, and this is the one control on the row that has to work one-handed. */
function RepsStepper({ reps, onChange }: { reps: number; onChange: (reps: number) => void }) {
  const button = (delta: number, label: string, disabled: boolean) => (
    <button
      type="button"
      onClick={() => onChange(reps + delta)}
      disabled={disabled}
      className="tap-target"
      aria-label={label}
      style={{
        background: "var(--crema-card)",
        border: "none",
        borderRadius: "var(--radius-pill)",
        width: 30,
        height: 30,
        fontSize: 16,
        lineHeight: 1,
        color: "var(--inchiostro)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.35 : 1,
      }}
    >
      {delta > 0 ? "+" : "−"}
    </button>
  );
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {button(-1, "Una ripetizione in meno", reps <= MIN_REPS)}
      <span className="font-mono" style={{ fontSize: 14, fontWeight: 600, minWidth: 34, textAlign: "center" }}>
        {reps} ×
      </span>
      {button(1, "Una ripetizione in più", reps >= MAX_REPS)}
    </span>
  );
}

function StepEditorModal({ step, onSave, onCancel }: { step: EditableStep; onSave: (step: EditableStep) => void; onCancel: () => void }) {
  const [type, setType] = useState<StepType>(step.type);
  const [durationType, setDurationType] = useState<Step["duration_type"]>(step.duration_type);
  const [durationValue, setDurationValue] = useState(step.duration_value);
  const [hasPace, setHasPace] = useState(!!step.target_pace);
  // Pace is typed -- and only ever typed -- as minutes per km ("4:40"), the same unit
  // the plan file and every other screen use. It lives in state as the raw text so a
  // half-typed "4:" isn't rounded into something else under the cursor; the seconds/km
  // the API wants are derived below, once, at save time.
  const [slowerText, setSlowerText] = useState(formatPaceMinSec(step.target_pace?.slower_sec_per_km ?? 300));
  const [fasterText, setFasterText] = useState(formatPaceMinSec(step.target_pace?.faster_sec_per_km ?? 280));

  /** Changing the type moves the pace target with it, because the two are not really
   * independent: a recovery without a target is the "two minutes of standing still"
   * this editor exists to avoid, and a target on a standing rest means nothing. */
  function changeType(next: StepType) {
    setType(next);
    if (next === "recovery" && !hasPace) {
      setSlowerText(formatPaceMinSec(420));
      setFasterText(formatPaceMinSec(360));
      setHasPace(true);
    }
    if (next === "rest") setHasPace(false);
  }

  const slowerSec = parsePaceMinSec(slowerText);
  const fasterSec = parsePaceMinSec(fasterText);
  const paceError = !hasPace
    ? null
    : slowerSec == null || fasterSec == null
      ? "Passo in minuti al km, tipo 4:40."
      : slowerSec === fasterSec
        ? "I due estremi devono essere diversi."
        : null;

  function handleDone() {
    if (paceError) return;
    onSave({
      ...step,
      type,
      duration_type: durationType,
      duration_value: durationValue,
      // Stored slower-bound-first whichever field each was typed in, the same
      // normalisation `parse_target_pace` applies to the plan file.
      target_pace:
        hasPace && slowerSec != null && fasterSec != null
          ? { slower_sec_per_km: Math.max(slowerSec, fasterSec), faster_sec_per_km: Math.min(slowerSec, fasterSec) }
          : null,
    });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,26,22,.45)", display: "flex", alignItems: "flex-end", zIndex: 20 }} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", background: "var(--crema)", borderRadius: "22px 22px 0 0", padding: "22px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <p style={{ font: "600 18px var(--font-outfit)", margin: 0 }}>Modifica step</p>

        <Field label="Tipo">
          <select value={type} onChange={(e) => changeType(e.target.value as StepType)} style={selectStyle}>
            {STEP_TYPES.map((t) => (
              <option key={t} value={t}>
                {stepTypeLabel(t)}
              </option>
            ))}
          </select>
          {/* What the chosen type actually does on the watch. Without this the
              difference between "Recupero" and "Riposo" is invisible until the
              workout is already running. */}
          <p className="font-serif-italic" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>
            {stepTypeHint(type)}
          </p>
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
          <Field label="Passo (min/km, più lento – più veloce)">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={slowerText}
                onChange={(e) => setSlowerText(e.target.value)}
                inputMode="numeric"
                placeholder="5:00"
                aria-label="Passo più lento, minuti al km"
                className="font-mono"
                style={{ ...selectStyle, flex: 1 }}
              />
              <span>–</span>
              <input
                value={fasterText}
                onChange={(e) => setFasterText(e.target.value)}
                inputMode="numeric"
                placeholder="4:40"
                aria-label="Passo più veloce, minuti al km"
                className="font-mono"
                style={{ ...selectStyle, flex: 1 }}
              />
            </div>
            {paceError && (
              <p role="alert" style={{ color: "var(--rosso-forte)", fontSize: 12, margin: "6px 0 0" }}>
                {paceError}
              </p>
            )}
          </Field>
        )}

        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
          <button
            type="button"
            onClick={handleDone}
            disabled={!!paceError}
            className="tap-target"
            style={{ flex: 1, background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "12px 0", fontSize: 14, fontWeight: 600, cursor: paceError ? "not-allowed" : "pointer", opacity: paceError ? 0.45 : 1 }}
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
