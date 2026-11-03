"use client";
import { TargetIcon as ScreenSymbol } from "@/components/Icons";

import { useState } from "react";
import { GOAL_TYPES, useSaveTrainingGoal, type GoalType, type TrainingGoal } from "@/lib/programDrafts";
import { dis } from "@/lib/disabled";
import { formatTargetTime } from "@/lib/raceGoal";
import { parseGoalTargetTime } from "@/lib/goalTargetTime";

const SPORT_OPTIONS = [
  { value: "running", label: "Corsa (strada / pista)" },
  { value: "running_trail", label: "Trail Running (corsa in montagna)" },
  { value: "cycling", label: "Bici / Ciclismo" },
  { value: "swimming", label: "Nuoto" },
  { value: "strength_training", label: "Forza / Palestra" },
  { value: "calisthenics", label: "Calisthenics" },
  { value: "other", label: "Altro sport" },
];

export function TrainingGoalForm({ goal, onSaved, onCancel }: { goal?: TrainingGoal; onSaved: (saved: TrainingGoal) => void; onCancel: () => void }) {
  const save = useSaveTrainingGoal();
  const [type, setType] = useState<GoalType>(goal?.type ?? (goal?.race_date ? "race" : "consistency"));
  const [name, setName] = useState(goal?.name ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const initialSport = goal?.sports[0] === "running" && goal?.elevation_gain_m ? "running_trail" : goal?.sports[0] ?? "running";
  const [sportChoice, setSportChoice] = useState(initialSport);
  const [priority, setPriority] = useState(goal?.priority ?? "secondary");
  const [date, setDate] = useState(goal?.race_date ?? goal?.deadline ?? goal?.review_date ?? "");
  const [target, setTarget] = useState(goal?.success_criterion?.target != null ? String(goal.success_criterion.target) : "");
  const [distance, setDistance] = useState(goal?.distance_km != null ? String(goal.distance_km) : "");
  const [elevationGain, setElevationGain] = useState(goal?.elevation_gain_m != null ? String(goal.elevation_gain_m) : "");
  const [targetTime, setTargetTime] = useState(goal?.target_time_seconds ? formatTargetTime(goal.target_time_seconds) : "");
  const [timeError, setTimeError] = useState<string | null>(null);

  const isTrail = sportChoice === "running_trail";
  const actualSport = isTrail ? "running" : sportChoice;
  const frequency = type === "consistency" || type === "maintenance";
  const ongoing = frequency || type === "fitness";

  return <form className="program-card program-form" onSubmit={async e => {
    e.preventDefault(); if (save.isPending || !name.trim()) return;
    const targetTimeSeconds = targetTime.trim() ? parseGoalTargetTime(targetTime) : null;
    if (type === "race" && targetTime.trim() && targetTimeSeconds == null) { setTimeError("Scrivi il tempo come 3:15:00 o 42:30."); return; }
    setTimeError(null);
    const criterion = frequency && target
      ? { metric: "sessions_per_week", target: Number(target), unit: "sedute/settimana" }
      : null;
    try {
      const saved = await save.mutateAsync({ id: goal?.id, body: {
        ...(goal ? { expected_revision: goal.revision } : {}),
        type,
        name: name.trim(),
        description: description.trim() || null,
        sports: [actualSport],
        priority,
        review_interval_days: 28,
        deadline: ongoing || type === "race" ? null : date || null,
        review_date: ongoing ? date || null : null,
        success_criterion: criterion,
        baseline: null,
        ...(type === "race" ? {
          race_date: date || null,
          distance_km: distance ? Number(distance) : null,
          elevation_gain_m: elevationGain ? Number(elevationGain) : null,
          target_time_seconds: targetTimeSeconds,
        } : {
          race_date: null,
          distance_km: null,
          elevation_gain_m: null,
          target_time_seconds: null,
        }),
      }});
      onSaved(saved);
    } catch { /* Error shown inline. */ }
  }}>
    <h3 className="icon-heading"><ScreenSymbol aria-hidden="true" />{goal ? "Modifica obiettivo" : "Nuovo obiettivo"}</h3>

    <label className="ux-field">
      Tipo di obiettivo
      <select value={type} onChange={e => {
        const next = e.target.value as GoalType;
        setType(next);
        if (next === "race" && sportChoice === "running") {
          // keep
        }
      }} data-track="goal-form.type">
        {Object.entries(GOAL_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select>
    </label>

    <label className="ux-field">
      Sport di riferimento
      <select value={sportChoice} onChange={e => setSportChoice(e.target.value)}>
        {SPORT_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
      </select>
    </label>

    <label className="ux-field">
      Nome dell’obiettivo
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        required
        placeholder={type === "race" ? (isTrail ? "Es. Cortina Trail 48K" : "Es. Maratona di Firenze") : frequency ? "Es. 3 corse a settimana" : "Es. Rinforzo salite e stabilità"}
        data-track="goal-form.name"
      />
    </label>

    {type === "race" && <>
      <div className="ux-filters">
        <label className="ux-field">
          Data della gara
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </label>
        <label className="ux-field">
          Distanza (km)
          <input type="number" min="0.1" step="any" value={distance} onChange={e => setDistance(e.target.value)} placeholder="Es. 42.195 o 21" required />
        </label>
      </div>

      <div className="ux-filters">
        <label className="ux-field">
          Dislivello D+ in metri (facoltativo)
          <input
            type="number"
            min="0"
            step="1"
            value={elevationGain}
            onChange={e => setElevationGain(e.target.value)}
            placeholder={isTrail ? "Es. 2600" : "Es. 150"}
            data-track="goal-form.elevation-gain"
          />
          <span className="field-hint">Fondamentale per trail running e gare di montagna.</span>
        </label>

        <label className="ux-field">
          Tempo obiettivo (facoltativo)
          <input
            type="text"
            inputMode="numeric"
            value={targetTime}
            onChange={e => { setTargetTime(e.target.value); setTimeError(null); }}
            placeholder="Es. 3:45:00 o 45:00"
            data-track="goal-form.target-time"
          />
          <span className="field-hint">Lascia vuoto se il traguardo è arrivare in fondo.</span>
        </label>
      </div>
    </>}

    {frequency && (
      <label className="ux-field">
        Quante sedute a settimana?
        <input type="number" min="1" max="14" step="1" value={target} onChange={e => setTarget(e.target.value)} placeholder="Es. 3" data-track="goal-form.target" />
      </label>
    )}

    {type !== "race" && !frequency && (
      <label className="ux-field">
        Data indicativa entro cui raggiungerlo (facoltativa)
        <input type="date" value={date} onChange={e => setDate(e.target.value)} />
      </label>
    )}

    <label className="ux-field">
      Note o dettagli (facoltativo)
      <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="Aggiungi indicazioni utili per te o per l'allenatore" />
    </label>

    <label className="ux-field">
      Priorità
      <select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}>
        <option value="primary">Obiettivo principale</option>
        <option value="secondary">Obiettivo secondario</option>
      </select>
    </label>

    {timeError && <p className="ux-error" role="alert">{timeError}</p>}
    {save.isError && <p className="ux-error" role="alert">{save.error.message}</p>}

    <div className="ux-actions">
      <button className="ux-button ux-button-primary" {...dis(save.isPending, "in_caricamento")} data-track="goal-form.save">
        {save.isPending ? "Salvo…" : "Salva obiettivo"}
      </button>
      <button type="button" className="ux-button" {...dis(save.isPending, "in_caricamento")} data-track="goal-form.cancel" onClick={onCancel}>
        Annulla
      </button>
    </div>
  </form>;
}
