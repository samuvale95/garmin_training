"use client";

import { useState } from "react";
import { GOAL_TYPES, useSaveTrainingGoal, type GoalType, type TrainingGoal } from "@/lib/programDrafts";
import { dis } from "@/lib/disabled";
import { formatTargetTime } from "@/lib/raceGoal";
import { parseGoalTargetTime } from "@/lib/goalTargetTime";

export function TrainingGoalForm({ goal, onSaved, onCancel }: { goal?: TrainingGoal; onSaved: (saved: TrainingGoal) => void; onCancel: () => void }) {
  const save = useSaveTrainingGoal();
  const [type, setType] = useState<GoalType>(goal?.type ?? "consistency");
  const [name, setName] = useState(goal?.name ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [sport, setSport] = useState(goal?.sports[0] ?? "running");
  const [priority, setPriority] = useState(goal?.priority ?? "secondary");
  const [date, setDate] = useState(goal?.race_date ?? goal?.deadline ?? goal?.review_date ?? "");
  const [metric, setMetric] = useState(goal?.success_criterion?.metric === "sessions_per_week" ? "" : goal?.success_criterion?.metric ?? "");
  const [target, setTarget] = useState(goal?.success_criterion?.target != null ? String(goal.success_criterion.target) : "");
  const [unit, setUnit] = useState(goal?.success_criterion?.unit ?? "");
  const [baseline, setBaseline] = useState(goal?.baseline?.value != null ? String(goal.baseline.value) : "");
  const [baselineDate, setBaselineDate] = useState(goal?.baseline?.recorded_at ?? "");
  const [distance, setDistance] = useState(goal?.distance_km != null ? String(goal.distance_km) : "");
  const [targetTime, setTargetTime] = useState(goal?.target_time_seconds ? formatTargetTime(goal.target_time_seconds) : "");
  const [timeError, setTimeError] = useState<string | null>(null);
  const [interval, setInterval] = useState(String(goal?.review_interval_days ?? 28));
  const frequency = type === "consistency" || type === "maintenance";
  const ongoing = frequency || type === "fitness";
  return <form className="program-card program-form" onSubmit={async e => {
    e.preventDefault(); if (save.isPending || !name.trim()) return;
    const targetTimeSeconds = targetTime.trim() ? parseGoalTargetTime(targetTime) : null;
    if (type === "race" && targetTime.trim() && targetTimeSeconds == null) { setTimeError("Scrivi il tempo come 3:15:00 o 42:30."); return; }
    setTimeError(null);
    const criterion = frequency
      ? target ? { metric: "sessions_per_week", target: Number(target), unit: "sedute/settimana" } : null
      : metric.trim() ? { metric: metric.trim(), target: target ? Number(target) : null, unit: unit.trim() || null } : null;
    try {
      const saved = await save.mutateAsync({ id: goal?.id, body: {
        ...(goal ? { expected_revision: goal.revision } : {}), type, name: name.trim(), description: description.trim() || null,
        sports: goal && sport === goal.sports[0] ? goal.sports : [sport], priority, review_interval_days: Number(interval),
        deadline: ongoing || type === "race" ? null : date || null, review_date: ongoing ? date || null : null,
        success_criterion: criterion, baseline: baseline ? { value: Number(baseline), recorded_at: baselineDate, source: "declared" } : null,
        ...(type === "race" ? { race_date: date || null, distance_km: distance ? Number(distance) : null, target_time_seconds: targetTimeSeconds } : { race_date: null, distance_km: null, target_time_seconds: null }),
      }}); onSaved(saved);
    } catch { /* Error shown inline. */ }
  }}>
    <h3>{goal ? "Modifica obiettivo" : "Nuovo obiettivo"}</h3>
    <label className="ux-field">Che cosa vuoi raggiungere?<select value={type} onChange={e => setType(e.target.value as GoalType)} data-track="goal-form.type">{Object.entries(GOAL_TYPES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label className="ux-field">Dai un nome al tuo obiettivo<input value={name} onChange={e => setName(e.target.value)} required placeholder={type === "race" ? "Es. Mezza maratona di Roma" : frequency ? "Es. Allenarmi con costanza" : "Es. Migliorare la forza"} data-track="goal-form.name" /></label>
    <label className="ux-field">Sport principale<select value={sport} onChange={e => setSport(e.target.value)}><option value="running">Corsa</option><option value="cycling">Bici</option><option value="swimming">Nuoto</option><option value="strength_training">Forza</option><option value="calisthenics">Calisthenics</option><option value="other">Altro</option></select></label>
    {type === "race" && <><label className="ux-field">Data della gara<input type="date" value={date} onChange={e => setDate(e.target.value)} required /></label><label className="ux-field">Distanza della gara (km)<input type="number" min="0.1" step="any" value={distance} onChange={e => setDistance(e.target.value)} required /></label><label className="ux-field">Tempo obiettivo (facoltativo)<input type="text" inputMode="numeric" value={targetTime} onChange={e => { setTargetTime(e.target.value); setTimeError(null); }} placeholder="Es. 1:45:00 o 42:30" data-track="goal-form.target-time" /><span className="field-hint">Ore:minuti:secondi oppure minuti:secondi.</span></label></>}
    {frequency && <label className="ux-field">Quante sedute a settimana? (facoltativo)<input type="number" min="1" step="1" value={target} onChange={e => setTarget(e.target.value)} placeholder="Es. 3" data-track="goal-form.target" /></label>}
    <details className="ux-disclosure"><summary>Altri dettagli (facoltativi)</summary><div className="program-form">
      <label className="ux-field">Note<textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="Aggiungi ciò che vuoi ricordare" /></label>
      <label className="ux-field">Priorità<select value={priority} onChange={e => setPriority(e.target.value as typeof priority)}><option value="primary">Principale</option><option value="secondary">Secondaria</option></select></label>
      {type !== "race" && <label className="ux-field">{ongoing ? "Quando vuoi rivedere l’obiettivo?" : "Entro quando?"}<input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}
      {!frequency && <><label className="ux-field">Indicatore personale (facoltativo)<input value={metric} onChange={e => setMetric(e.target.value)} placeholder="Es. Carico nello squat" data-track="goal-form.metric" /></label><p className="ux-muted">Questo indicatore è una tua annotazione. La valutazione automatica usa la gara o le sedute settimanali; per forza, forma e prestazione servono test o misure confrontabili non ancora disponibili nello storico.</p><div className="ux-filters"><label className="ux-field">Valore desiderato<input type="number" min="0.000001" step="any" value={target} onChange={e => setTarget(e.target.value)} /></label><label className="ux-field">Unità di misura<input value={unit} onChange={e => setUnit(e.target.value)} placeholder="Es. kg" /></label></div></>}
      <div className="ux-filters"><label className="ux-field">Valore di partenza<input type="number" step="any" value={baseline} onChange={e => setBaseline(e.target.value)} /></label><label className="ux-field">Data del valore iniziale<input type="date" required={!!baseline} value={baselineDate} onChange={e => setBaselineDate(e.target.value)} /></label></div>
      <label className="ux-field">Intervallo per la valutazione (giorni)<input type="number" min="1" max="366" value={interval} onChange={e => setInterval(e.target.value)} required /></label>
    </div></details>
    {timeError && <p className="ux-error" role="alert">{timeError}</p>}{save.isError && <p className="ux-error" role="alert">{save.error.message}</p>}
    <div className="ux-actions"><button className="ux-button ux-button-primary" {...dis(save.isPending, "in_caricamento")} data-track="goal-form.save">{save.isPending ? "Salvo…" : "Salva obiettivo"}</button><button type="button" className="ux-button" {...dis(save.isPending, "in_caricamento")} data-track="goal-form.cancel" onClick={onCancel}>Annulla</button></div>
  </form>;
}
