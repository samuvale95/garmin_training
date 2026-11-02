"use client";

import type { Dispatch, SetStateAction } from "react";
import Link from "next/link";
import type { TrainingGoal } from "@/lib/programDrafts";
import { dis } from "@/lib/disabled";

type Mode = "new" | "merge" | "replace";
type Props = {
  name: string; setName: Dispatch<SetStateAction<string>>;
  goalId: string; setGoalId: Dispatch<SetStateAction<string>>; createGoalHref: string; goals: TrainingGoal[];
  mode: Mode; setMode: Dispatch<SetStateAction<Mode>>; target: string; setTarget: Dispatch<SetStateAction<string>>;
  plans: { id: string; name: string }[]; yaml: string; setYaml: Dispatch<SetStateAction<string>>;
  fileName: string; setFileName: Dispatch<SetStateAction<string>>; busy: boolean; unavailable: boolean;
  error: string | null; setError: Dispatch<SetStateAction<string | null>>; save: () => void;
};

export function ImportForm({ name, setName, goalId, setGoalId, createGoalHref, goals, mode, setMode, target, setTarget, plans, yaml, setYaml, fileName, setFileName, busy, unavailable, error, setError, save }: Props) {
  return <div className="program-form">
    <p className="ux-muted">Date, sport e allenamenti vengono letti dal file. Potrai controllare e modificare le sedute nella bozza prima di attivarla.</p>
    <div className="program-upload">
      <input id="program-yaml-file" className="program-upload-input" type="file" accept=".yaml,.yml,text/yaml" data-track="program-new.file" onChange={async e => {
        const input = e.target; const file = input.files?.[0]; if (!file) return;
        try { setYaml(await file.text()); setFileName(file.name); setError(null); if (!name || name === fileName.replace(/\.ya?ml$/i, "")) setName(file.name.replace(/\.ya?ml$/i, "")); }
        catch { setError("Non riesco a leggere il file. Riprova o incolla il contenuto."); }
        input.value = "";
      }} />
      <label htmlFor="program-yaml-file" className="program-upload-label"><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></svg><span><strong>{fileName ? "Scegli un altro file" : "Scegli un file YAML"}</strong><small>{fileName || "Formati .yaml e .yml"}</small></span></label>
    </div>
    <details className="ux-disclosure"><summary>Oppure incolla il contenuto YAML</summary><label className="ux-field">Contenuto del file<textarea value={yaml} onChange={e => { setYaml(e.target.value); setFileName(""); }} rows={10} data-track="program-new.yaml" /></label></details>
    <label className="ux-field">Nome del programma<input autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="Es. Preparazione mezza maratona" data-track="program-new.name" /></label>
    <label className="ux-field">Collega a un obiettivo (facoltativo)<select value={goalId} onChange={e => setGoalId(e.target.value)} data-track="program-new.goal"><option value="">Nessun obiettivo collegato</option>{goals.filter(g => g.status === "active").map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select><span className="field-hint">Un eventuale obiettivo nel file non viene collegato automaticamente: selezionalo qui se esiste già.</span></label>
    <Link href={createGoalHref} className="ux-button" data-track="program-new.create-goal">Crea un obiettivo</Link>
    <label className="ux-field">Dove vuoi aggiungere le sedute?<select value={mode} onChange={e => setMode(e.target.value as Mode)} data-track="program-new.mode"><option value="new">In un nuovo programma</option><option value="merge">In un programma esistente</option><option value="replace">Sostituisci un programma esistente</option></select></label>
    {mode !== "new" && <label className="ux-field">Programma da {mode === "replace" ? "sostituire" : "aggiornare"}<select value={target} onChange={e => setTarget(e.target.value)} data-track="program-new.target"><option value="">Seleziona un programma</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
    <p className="ux-muted">La verifica della bozza confronterà le sedute con il calendario e la disponibilità già salvata.</p>
    {error && <p className="ux-error" role="alert">{error}</p>}
    <button className="ux-button ux-button-primary" data-track="program-new.save-draft" {...dis(busy || unavailable || !yaml.trim() || !name.trim() || (mode !== "new" && !target), busy ? "in_caricamento" : unavailable ? "contesto_non_disponibile" : "campi_mancanti")} onClick={save}>{busy ? "Importo…" : "Importa e rivedi le sedute"}</button>
  </div>;
}
