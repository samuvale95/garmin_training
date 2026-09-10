"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { SlideUp } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { GOAL_LOOKAHEAD_DAYS, useGoalFit, useGoalFitNarrative, usePlanQuery, useRaceGoal, useSetRaceGoal, useWorkouts } from "@/lib/queries";
import { GoalFitBlock } from "@/components/GoalFitBlock";
import { countdownLabel, distanceLabel, formatPaceSecPerKm, formatTargetTime, targetPaceSecPerKm } from "@/lib/raceGoal";
import { formatFullDate } from "@/lib/format";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import type { RaceGoal } from "@/lib/types";

/** The distances offered as one tap. Anything else is typed in km -- these are only
 * the four that account for nearly every race a plan gets written for. */
const PRESET_DISTANCES: { label: string; km: number }[] = [
  { label: "5 km", km: 5 },
  { label: "10 km", km: 10 },
  { label: "mezza", km: 21.0975 },
  { label: "maratona", km: 42.195 },
];

/** `H:MM:SS` / `MM:SS` typed by a person, as seconds. `null` for anything else --
 * including a bare number, which is ambiguous by a factor of sixty. */
function parseTargetTime(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const values = parts.map(Number);
  if (values.slice(1).some((v) => v > 59)) return null;
  return values.length === 2 ? values[0] * 60 + values[1] : values[0] * 3600 + values[1] * 60 + values[2];
}

/** Set, change or clear the race the plan is written for.
 *
 * The YAML file can state a `goal:` block and is still the way a plan arrives, but the
 * app has been editing the plan (dragging sessions between days, rewriting steps) since
 * long before this screen -- so a race date typed here is the same kind of edit, and
 * travels back into the file on the next download.
 */
export default function RaceGoalSettingsPage() {
  const animate = useMountOnce("settings-goal");
  const router = useRouter();
  const { data: plan, isHydrated } = usePlanQuery();
  const setRaceGoal = useSetRaceGoal();

  // Live Garmin-calendar mode has no plan to hold a goal, so it gets its own storage
  // (see `useRaceGoal`) -- this is the one thing on this screen that works with or
  // without a plan; everything below it still needs one.
  const access = useCalendarAccess();
  const liveMode = !plan && access.garminConnected;
  const hasTrainingContext = !!plan || access.garminConnected;
  // Neither answer is final until the plan has been restored *and*, if there wasn't
  // one, the Garmin status check has landed -- otherwise a live-mode account would
  // flash the "prima serve un piano" wall for a tick before its calendar shows up.
  const stillDeciding = !isHydrated || (!plan && !access.ready);
  const { goal } = useRaceGoal(plan ?? null, isHydrated && (!!plan || access.ready));

  const todayKey = toDateKey(new Date());
  // The sessions already there, read against whatever race is set. This is the whole
  // point of the block below: a goal named today is compared with workouts written
  // weeks (or, for a live calendar, days) ago, without importing anything again. With
  // no plan the range is bounded by the race once one exists, or a fixed lookahead
  // before that -- just enough to say "you have sessions ahead" honestly.
  const liveRangeEnd = goal ? goal.race_date : shiftDateKey(todayKey, GOAL_LOOKAHEAD_DAYS);
  const workoutsQuery = useWorkouts(todayKey, liveRangeEnd, liveMode);
  const sessions = useMemo(
    () => (plan?.sessions ?? workoutsToSessions(workoutsQuery.data?.workouts ?? [])),
    [plan?.sessions, workoutsQuery.data]
  );
  const upcomingSessions = sessions.filter((s) => s.date >= todayKey).length;

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [raceDate, setRaceDate] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [targetTime, setTargetTime] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fitQuery = useGoalFit(sessions, goal, !!goal && !editing);
  const fitNarrative = useGoalFitNarrative(sessions, goal, !!goal && !editing && !!fitQuery.data);

  function startEdit() {
    setName(goal?.name ?? "");
    setRaceDate(goal?.race_date ?? "");
    setDistanceKm(goal ? String(goal.distance_km) : "");
    setTargetTime(goal?.target_time_seconds != null ? formatTargetTime(goal.target_time_seconds) : "");
    setError(null);
    setEditing(true);
  }

  function save() {
    if (!raceDate) return setError("Serve la data della gara.");
    const km = Number(distanceKm.replace(",", "."));
    if (!Number.isFinite(km) || km <= 0) return setError("Serve una distanza in chilometri.");
    const seconds = targetTime.trim() ? parseTargetTime(targetTime) : null;
    if (targetTime.trim() && seconds == null) return setError("Il tempo obiettivo va scritto come 3:15:00 o 42:30.");

    // `phase` and `days_to_race` are deliberately absent: the server computes them from
    // the date and they come back on the next save (see `useSetRaceGoal`).
    const next: RaceGoal = {
      race_date: raceDate,
      distance_km: km,
      name: name.trim() || null,
      target_time_seconds: seconds,
    };
    setRaceGoal(next);
    setEditing(false);
  }

  function clearGoal() {
    setRaceGoal(null);
    setEditing(false);
  }

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/settings" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>Obiettivo</h1>
      </div>

      {stillDeciding ? (
        <p style={{ marginTop: 20, color: "var(--inchiostro-50)" }}>Carico…</p>
      ) : !hasTrainingContext ? (
        <SlideUp active={animate} delayMs={100} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 18 }}>
          <p style={{ font: "600 17px/1.2 var(--font-outfit)", margin: 0 }}>Prima serve un allenamento</p>
          <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", margin: "10px 0 0", lineHeight: 1.35 }}>
            La gara si legge contro sedute che esistono già: importa un piano, o collega Garmin
            e torna qui.
          </p>
          <button
            type="button"
            onClick={() => router.push("/import")}
            className="press-soft"
            style={{ background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "12px 18px", marginTop: 16, fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Importa un piano
          </button>
        </SlideUp>
      ) : editing ? (
        <GoalForm
          name={name}
          setName={setName}
          raceDate={raceDate}
          setRaceDate={setRaceDate}
          distanceKm={distanceKm}
          setDistanceKm={setDistanceKm}
          targetTime={targetTime}
          setTargetTime={setTargetTime}
          error={error}
          onSave={save}
          onCancel={() => setEditing(false)}
          onClear={goal ? clearGoal : undefined}
          animate={animate}
        />
      ) : goal ? (
        <>
          <GoalSummary goal={goal} animate={animate} onEdit={startEdit} />
          {fitQuery.data ? (
            <>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: "22px 0 0" }}>
                Il piano che hai già
              </p>
              <GoalFitBlock fit={fitQuery.data} narrative={fitNarrative.data?.text} animate={animate} delayMs={240} />
            </>
          ) : fitQuery.isLoading ? (
            <p style={{ fontSize: 13, color: "var(--inchiostro-50)", marginTop: 20 }}>Sto rileggendo il piano…</p>
          ) : null}
        </>
      ) : (
        <SlideUp active={animate} delayMs={100} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 18 }}>
          <p style={{ font: "600 17px/1.2 var(--font-outfit)", margin: 0 }}>{plan ? "Nessuna gara nel piano" : "Nessuna gara impostata"}</p>
          <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", margin: "10px 0 0", lineHeight: 1.35 }}>
            Si allena meglio sapendo per cosa. Dimmi che gara stai preparando e quando:
            serve a capire in che punto della preparazione sei, e cosa proporti quando una
            giornata storta consiglia di cambiare la seduta.
          </p>
          {/* The same promise the card on Oggi makes, kept where it gets fulfilled:
              nothing is re-imported, the sessions already there get read again. */}
          {upcomingSessions > 0 && (
            <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", margin: "10px 0 0", lineHeight: 1.35 }}>
              Le <span className="font-mono" style={{ fontSize: 14, fontStyle: "normal" }}>{upcomingSessions}</span> sedute che
              hai già in calendario restano dove sono: le rileggo per dirti se ti portano lì.
            </p>
          )}
          <button
            type="button"
            onClick={startEdit}
            className="press-soft"
            style={{ background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "13px 20px", marginTop: 16, fontSize: 14.5, fontWeight: 600, cursor: "pointer" }}
          >
            Aggiungi la gara
          </button>
        </SlideUp>
      )}

      {plan && (
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "16px 0 0", lineHeight: 1.4 }}>
          Puoi anche scriverla nel file, come blocco <span className="font-mono">goal:</span> sopra{" "}
          <span className="font-mono">sessions:</span> — e quello che imposti qui torna nel file quando lo scarichi.
        </p>
      )}
    </div>
  );
}

function GoalSummary({ goal, animate, onEdit }: { goal: RaceGoal; animate: boolean; onEdit: () => void }) {
  const pace = targetPaceSecPerKm(goal);

  return (
    <>
      <SlideUp active={animate} delayMs={100} style={{ position: "relative", overflow: "hidden", background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 22, marginTop: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)" }}>
            {goal.phase === "gara passata" ? "gara corsa" : "obiettivo"}
          </span>
          {goal.phase && goal.phase !== "gara passata" && (
            <span style={{ background: "rgba(246,238,218,.12)", borderRadius: "var(--radius-pill)", padding: "4px 11px", fontSize: 11, fontWeight: 600 }}>{goal.phase}</span>
          )}
        </div>

        <p style={{ font: "600 26px/1.1 var(--font-outfit)", letterSpacing: "-.02em", margin: "10px 0 2px" }}>
          {goal.name?.trim() || distanceLabel(goal.distance_km)}
        </p>
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-su-scuro)", margin: 0 }}>{formatFullDate(goal.race_date)}</p>

        <p className="font-mono" style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-.02em", color: "var(--corallo)", margin: "18px 0 0" }}>
          {countdownLabel(goal)}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 14 }}>
          <span className="font-mono" style={{ fontSize: 13, color: "var(--inchiostro-su-scuro)" }}>{distanceLabel(goal.distance_km)}</span>
          {goal.target_time_seconds != null ? (
            <>
              <span className="font-mono" style={{ fontSize: 13, color: "var(--inchiostro-su-scuro)" }}>
                obiettivo {formatTargetTime(goal.target_time_seconds)}
              </span>
              {pace != null && (
                <span className="font-mono" style={{ fontSize: 13, color: "var(--inchiostro-su-scuro)" }}>{formatPaceSecPerKm(pace)}/km</span>
              )}
            </>
          ) : (
            <span className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-su-scuro)" }}>senza tempo obiettivo</span>
          )}
        </div>
      </SlideUp>

      <SlideUp active={animate} delayMs={200} style={{ marginTop: 12 }}>
        <button
          type="button"
          onClick={onEdit}
          className="press-soft"
          style={{ width: "100%", background: "var(--sabbia)", border: "none", borderRadius: "var(--radius-pill)", padding: "15px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer", color: "var(--inchiostro)" }}
        >
          Modifica
        </button>
      </SlideUp>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 10 }}>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 4px" }}>{label}</p>
      {children}
    </div>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 17,
  fontWeight: 600,
  outline: "none",
  color: "var(--inchiostro)",
  fontFamily: "inherit",
};

function GoalForm({
  name,
  setName,
  raceDate,
  setRaceDate,
  distanceKm,
  setDistanceKm,
  targetTime,
  setTargetTime,
  error,
  onSave,
  onCancel,
  onClear,
  animate,
}: {
  name: string;
  setName: (v: string) => void;
  raceDate: string;
  setRaceDate: (v: string) => void;
  distanceKm: string;
  setDistanceKm: (v: string) => void;
  targetTime: string;
  setTargetTime: (v: string) => void;
  error: string | null;
  onSave: () => void;
  onCancel: () => void;
  onClear?: () => void;
  animate: boolean;
}) {
  return (
    <SlideUp active={animate} delayMs={80} style={{ marginTop: 18 }}>
      <Field label="che gara è">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maratona di Firenze" style={INPUT_STYLE} />
      </Field>

      <Field label="quando">
        <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} className="font-mono" style={INPUT_STYLE} />
      </Field>

      <Field label="distanza">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {PRESET_DISTANCES.map((preset) => {
            const selected = Math.abs(Number(distanceKm.replace(",", ".")) - preset.km) < 0.001;
            return (
              <button
                key={preset.label}
                type="button"
                onClick={() => setDistanceKm(String(preset.km))}
                className="press-soft"
                style={{
                  background: selected ? "var(--inchiostro)" : "var(--sabbia)",
                  color: selected ? "var(--crema)" : "var(--inchiostro-70)",
                  border: "none",
                  borderRadius: "var(--radius-pill)",
                  padding: "8px 14px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <input
            inputMode="decimal"
            value={distanceKm}
            onChange={(e) => setDistanceKm(e.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="21,0975"
            className="font-mono"
            style={INPUT_STYLE}
          />
          <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>km</span>
        </div>
      </Field>

      <Field label="tempo obiettivo (facoltativo)">
        <input
          value={targetTime}
          onChange={(e) => setTargetTime(e.target.value)}
          placeholder="3:15:00"
          inputMode="numeric"
          className="font-mono"
          style={INPUT_STYLE}
        />
      </Field>

      <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "10px 0 0", lineHeight: 1.4 }}>
        Senza tempo obiettivo va benissimo: &quot;arrivare in fondo&quot; è un obiettivo, e non lo
        trasformo in un ritmo.
      </p>

      {error && (
        <p style={{ background: "var(--rosa-avviso)", color: "var(--rosso-testo)", borderRadius: "var(--radius-card)", padding: "12px 14px", fontSize: 13.5, fontWeight: 600, margin: "12px 0 0" }}>
          {error}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button
          type="button"
          onClick={onCancel}
          className="press-soft"
          style={{ background: "var(--sabbia)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer", color: "var(--inchiostro)" }}
        >
          Annulla
        </button>
        <button
          type="button"
          onClick={onSave}
          className="press-soft"
          style={{ flex: 1, background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          Salva
        </button>
      </div>

      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="press-soft"
          style={{ width: "100%", background: "none", border: "none", color: "var(--rosso-avviso)", padding: "14px 0 0", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Togli la gara
        </button>
      )}
    </SlideUp>
  );
}
