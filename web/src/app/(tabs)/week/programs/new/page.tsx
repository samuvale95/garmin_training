"use client";

import { Suspense, useEffect, useState } from "react";
import { SparklesIcon, UploadIcon } from "@/components/Icons";
import { ImportForm } from "@/components/ImportProgramForm";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/motion/primitives";
import { PlanNavigation, WorkspaceHeading } from "@/components/Workspace";
import { usePlanListQuery } from "@/lib/queries";
import { useDraftMutation, useTrainingGoals, useProgramConstraints, type DraftInput } from "@/lib/programDrafts";
import { useScreenReady } from "@/lib/useScreenReady";
import { useMounted } from "@/lib/hydration";
import { dis } from "@/lib/disabled";
import { shiftDateKey, toDateKey } from "@/lib/sessionVisuals";

const SPORTS = { running: "Corsa", cycling: "Bici", swimming: "Nuoto", strength_training: "Forza", calisthenics: "Calisthenics" };
// What the plan generator writes (see `programs.AI_SPORTS` on the server).
const AI_SPORTS = ["running", "calisthenics", "strength_training", "cycling", "swimming"];
const DAYS = ["Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato", "Domenica"];
const STEPS = ["Obiettivo", "Disponibilità", "Contesto", "Riepilogo"];
function NewProgramContent() {
  const router = useRouter(); const params = useSearchParams();
  const storageKey = `passo-program-wizard:${params.get("target") ?? "new"}`;
  const [restored] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as Record<string, unknown> | null; } catch { return null; } });
  const requestedSource = params.get("source") === "ai" ? "ai" : params.get("source") === "import" ? "import" : null;
  const restoredSource = restored?.source === "ai" || restored?.source === "import" ? restored.source : null;
  const [sourceConflict, setSourceConflict] = useState(Boolean(requestedSource && restoredSource && requestedSource !== restoredSource));
  const programs = usePlanListQuery(); const goals = useTrainingGoals(); const constraints = useProgramConstraints();
  const create = useDraftMutation("create");
  const [source, setSource] = useState<"ai" | "import" | null>(sourceConflict ? null : requestedSource ?? restoredSource);
  const [step, setStep] = useState(Number(restored?.step ?? 0)); const [name, setName] = useState(String(restored?.name ?? "")); const [goalId, setGoalId] = useState(params.get("goalId") ?? String(restored?.goalId ?? ""));
  const [sports, setSports] = useState<string[]>((restored?.sports as string[]) ?? ["running"]); const startDate = shiftDateKey(toDateKey(new Date()), 1);
  const [days] = useState<number[] | null>((restored?.days as number[] | null) ?? null); const [minutes] = useState(String(restored?.minutes ?? "")); const [double] = useState(Boolean(restored?.double));
  const [prompt, setPrompt] = useState(String(restored?.prompt ?? "")); const [yaml, setYaml] = useState(String(restored?.yaml ?? "")); const [fileName, setFileName] = useState(String(restored?.fileName ?? ""));
  const [mode, setMode] = useState<"new" | "merge" | "replace">((restored?.mode as "new"|"merge"|"replace") ?? (params.get("target") ? "replace" : "new")); const [target, setTarget] = useState(String(restored?.target ?? params.get("target") ?? ""));
  const [localError, setLocalError] = useState<string | null>(null);
  const goalChangedByLink = params.has("goalId") && String(restored?.goalId ?? "") !== (params.get("goalId") ?? "");
  useEffect(() => { if (sourceConflict) return; try { sessionStorage.setItem(storageKey, JSON.stringify({ source, step, name, goalId, sports, startDate, days, minutes, double, prompt, yaml, fileName, mode, target })); } catch { /* The server draft remains the durable save at the end of the wizard. */ } }, [storageKey, sourceConflict, source, step, name, goalId, sports, startDate, days, minutes, double, prompt, yaml, fileName, mode, target]);
  useScreenReady(!programs.isPending && !goals.isPending && !constraints.isPending);
  const availableDays = constraints.data?.available_days;
  const busy = create.isPending;
  const contextError = programs.isError || goals.isError || (source === "ai" && constraints.isError);
  const active = programs.data?.plans.filter(p => p.is_active) ?? [];
  const returnParams = new URLSearchParams(params.toString());
  if (source) returnParams.set("source", source);
  const createGoalHref = `/week/goals?new=1&returnTo=${encodeURIComponent(`/week/programs/new?${returnParams.toString()}`)}`;
  async function saveDraft() {
    if (busy) return; setLocalError(null);
    if (contextError) { setLocalError("Il contesto non è disponibile. Riprova a caricarlo prima di salvare la bozza."); return; }
    if (!name.trim()) { setLocalError("Dai un nome al programma."); return; }
    if (mode !== "new" && !target) { setLocalError("Scegli il programma di destinazione."); return; }
    if (goalId && !goals.data?.goals.some(g => g.id === goalId && g.status === "active")) { setLocalError("Scegli un obiettivo attivo oppure nessun obiettivo."); return; }
    if (source === "ai" && sports.length === 0) { setLocalError("Scegli almeno uno sport."); return; }
    if (source === "ai" && sports.some((s) => !AI_SPORTS.includes(s))) { setLocalError("Uno degli sport scelti non è ancora supportato dalla generazione AI."); return; }
    if (source === "import" && !yaml.trim()) { setLocalError("Carica un file YAML o incolla il contenuto."); return; }
    try {
      const body: DraftInput = { name: name.trim(), source: source!, mode, target_plan_id: mode === "new" ? null : target, goal_id: goalId || null, inputs: source === "import" ? { file_name: fileName || undefined } : { sports, user_prompt: prompt, start_date: startDate }, ...(source === "import" ? { original_yaml: yaml } : {}) };
      const draft = await create.mutateAsync({ body }); sessionStorage.removeItem(storageKey); router.push(`/week/programs/drafts/${draft.id}`);
    } catch (error) { setLocalError(error instanceof Error ? error.message : "Impossibile salvare la bozza. Gli input restano nel modulo."); }
  }
  return <div className="workspace-page"><PageHeader backHref="/week/programs" /><WorkspaceHeading title="Piano" description="Un nuovo programma, prima in bozza." /><PlanNavigation />
    {goalChangedByLink && <p className="ux-notice" role="status">Il link ha selezionato un obiettivo diverso da quello presente nel modulo precedente. Puoi cambiarlo prima di salvare la bozza.</p>}
    {contextError && <div className="ux-error" role="alert"><p>Non riesco a caricare programmi, obiettivi o disponibilità.</p><button className="ux-button" data-track="program-new.retry-context" {...dis(programs.isFetching || goals.isFetching || constraints.isFetching, "in_caricamento")} onClick={() => { if (programs.isError) programs.refetch(); if (goals.isError) goals.refetch(); if (constraints.isError) constraints.refetch(); }}>Riprova</button></div>}
    {sourceConflict ? <div className="program-card"><h2 className="ux-section-title">Riprendere il percorso precedente?</h2><p>Hai un modulo {restoredSource === "ai" ? "AI" : "di importazione"} in corso. Il link apre {requestedSource === "ai" ? "AI" : "l’importazione"}. I dati compilati restano nel modulo finché non salvi la bozza.</p><div className="ux-actions"><button className="ux-button" data-track="program-new.resume-source" onClick={() => { setSource(restoredSource); setSourceConflict(false); const next = new URLSearchParams(params.toString()); next.set("source", restoredSource!); router.replace(`/week/programs/new?${next.toString()}`); }}>Riprendi il precedente</button><button className="ux-button ux-button-primary" data-track="program-new.requested-source" onClick={() => { setSource(requestedSource); setStep(0); setSourceConflict(false); }}>Apri il percorso del link</button></div></div> : !source ? <><h2 className="ux-section-title">Come vuoi creare il programma?</h2><div className="program-source-grid"><button className="program-source" data-track="program-new.ai" onClick={() => setSource("ai")}><strong><SparklesIcon size={20} aria-hidden="true" /> Crea con AI</strong><span>Definisci obiettivo, disponibilità e preferenze. Controlla le sedute prima di attivare.</span></button><button className="program-source" data-track="program-new.import" onClick={() => setSource("import")}><strong><UploadIcon size={20} aria-hidden="true" /> Importa un file</strong><span>Carica o incolla un programma YAML/YML. Verifica date e compatibilità.</span></button></div><p className="ux-muted">Le bozze restano separate dal calendario e non vengono inviate a Garmin. Dopo l’attivazione, l’invio a Garmin Connect parte automaticamente.</p></> : <>
      <div className="program-topline"><h2 className="ux-section-title">{source === "ai" ? "Crea con AI" : "Importa un file"}</h2><button className="ux-button" data-track="program-new.change-source" onClick={() => { setSource(null); setStep(0); setLocalError(null); }}>Cambia percorso</button></div>
      {source === "import" ? <ImportForm name={name} setName={setName} goalId={goalId} setGoalId={setGoalId} createGoalHref={createGoalHref} goals={goals.data?.goals ?? []} mode={mode} setMode={setMode} target={target} setTarget={setTarget} plans={programs.data?.plans ?? []} yaml={yaml} setYaml={setYaml} fileName={fileName} setFileName={setFileName} busy={busy} unavailable={contextError} error={localError} setError={setLocalError} save={saveDraft} /> : <>
      <ol className="program-steps" aria-label="Passi creazione">{STEPS.map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
      <p className="ux-muted">Passo {step + 1} di 4 · {STEPS[step]}</p>
      {step === 0 && <div className="program-form"><label className="ux-field">Nome programma<input autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="Es. Forza per la corsa" data-track="program-new.name" /></label><label className="ux-field">Obiettivo<select value={goalId} onChange={e => setGoalId(e.target.value)} data-track="program-new.goal"><option value="">Programma libero, senza obiettivo specifico</option>{(goals.data?.goals ?? []).filter(g => g.status === "active").map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label><Link href={createGoalHref} className="ux-button" data-track="program-new.create-goal">Crea un obiettivo</Link><fieldset className="ux-fieldset"><legend>Sport del programma</legend><p className="ux-muted">Con l’AI: corsa, calisthenics, forza, bici e nuoto. L’orologio mostra esercizi e ripetizioni, watt e cadenza, stile e vasca.</p><div className="ux-actions">{Object.entries(Object.fromEntries(AI_SPORTS.map((s) => [s, SPORTS[s as keyof typeof SPORTS]]))).map(([id, label]) => <label key={id} className="ux-check"><input type="checkbox" checked={sports.includes(id)} onChange={e => setSports(e.target.checked ? [...sports, id] : sports.filter(s => s !== id))} />{label}</label>)}</div></fieldset>

      </div>}
      {step === 1 && <div className="program-form"><label className="ux-field">Inizio della finestra generata: domani<input type="date" readOnly value={startDate} data-track="program-new.start-date" /></label><h3>Disponibilità comune ai programmi</h3><p className="ux-muted">La generazione e la verifica usano la disponibilità globale già salvata. Creare una bozza non modifica questa impostazione.</p><p className="program-details">Giorni: {availableDays?.length ? availableDays.map(d => DAYS[d]).join(", ") : "Non dichiarati"} · Tempo massimo: {constraints.data?.max_daily_minutes != null ? `${constraints.data.max_daily_minutes} min al giorno` : "non dichiarato"} · Sedute al giorno: {constraints.data?.max_sessions_per_day ?? "non dichiarate"}</p>{(days !== null || minutes || double) && <p className="ux-notice" role="status">Questo modulo contiene una precedente scelta di disponibilità. Non verrà applicata alla bozza: controlla la disponibilità globale prima di continuare.</p>}<Link href="/week/programs#availability" className="ux-button" data-track="program-new.edit-availability">Apri disponibilità globale</Link><p className="ux-muted">Se mancano vincoli dichiarati, la revisione segnalerà i controlli che non è stato possibile completare.</p></div>}
      {step === 2 && <><h3>Programmi già attivi</h3>{active.length ? active.map(p => <article className="program-card" key={p.id}><strong>{p.name}</strong><p className="program-details">{p.sessions_count} sedute · {p.sports.map(s => SPORTS[s as keyof typeof SPORTS] ?? s).join(", ")}</p></article>) : <p className="ux-muted">Non risultano programmi attivi.</p>}<p className="ux-muted">La bozza considera gli impegni di tutti i programmi attivi e conserva le sedute esistenti. Attività recenti e dati disponibili vengono letti dal servizio; quelli mancanti saranno segnalati.</p><label className="ux-field">Destinazione<select value={mode} onChange={e => setMode(e.target.value as typeof mode)} data-track="program-new.mode"><option value="new">Nuovo programma</option><option value="merge">Aggiungi a un programma esistente</option><option value="replace">Sostituisci un programma esistente</option></select></label>{mode !== "new" && <label className="ux-field">Programma da {mode === "replace" ? "sostituire" : "aggiornare"}<select value={target} onChange={e => setTarget(e.target.value)} data-track="program-new.target"><option value="">Scegli per nome</option>{(programs.data?.plans ?? []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<label className="ux-field" style={{ marginTop: 20 }}>Altre indicazioni (facoltativo)<textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={4} placeholder="Es. Preferisco il lungo la domenica" data-track="program-new.preferences" /></label><p className="ux-muted">Le indicazioni libere sono preferenze. I vincoli verificabili sono giorni, tempo disponibile e numero di sedute.</p></>}
      {step === 3 && <section className="program-card"><h3>{name || "Programma senza nome"}</h3><p className="program-details">Proposta AI · dal {startDate}</p><p className="program-details">Obiettivo: {goals.data?.goals.find(g => g.id === goalId)?.name ?? "Programma libero"}</p><p className="program-details">Disponibilità globale: {availableDays?.length ? availableDays.map(d => DAYS[d]).join(", ") : "Non dichiarata"} · {constraints.data?.max_daily_minutes != null ? `${constraints.data.max_daily_minutes} min al giorno` : "Tempo non dichiarato"} · {constraints.data?.max_sessions_per_day != null ? `${constraints.data.max_sessions_per_day} sedute al giorno` : "Sedute non dichiarate"}</p><p className="program-details">Destinazione: {mode === "new" ? "Nuovo programma" : `${mode === "merge" ? "Aggiungi a" : "Sostituisci"} ${programs.data?.plans.find(p => p.id === target)?.name ?? "Da selezionare"}`}</p>{prompt && <p className="program-details">Preferenze: {prompt}</p>}<p className="ux-muted">La strategia può coprire l’obiettivo, ma le sedute dettagliate riguardano la finestra effettivamente supportata dal generatore (normalmente 15–21 giorni da domani). Le date effettive compariranno nella revisione.</p></section>}
      {localError && <div className="ux-error" role="alert">{localError}</div>}
      <div className="ux-actions"><button className="ux-button" data-track="program-new.previous" {...dis(step === 0 || busy, busy ? "in_caricamento" : "primo_passo")} onClick={() => setStep(step - 1)}>Indietro</button>{step < 3 ? <button className="ux-button ux-button-primary" data-track="program-new.next" {...dis(step === 0 && (!name.trim() || sports.length === 0), "campi_mancanti")} onClick={() => setStep(step + 1)}>Continua</button> : <button className="ux-button ux-button-primary" data-track="program-new.save-draft" {...dis(busy || contextError, busy ? "in_caricamento" : "contesto_non_disponibile")} onClick={saveDraft}>{busy ? "Salvo bozza…" : "Salva bozza e controlla"}</button>}</div>
      </>}
    </>}
  </div>;
}
function MountedWizard() { const mounted = useMounted(); return mounted ? <NewProgramContent /> : <Skeleton height={200} />; }
export default function NewProgramPage() { return <Suspense fallback={<Skeleton height={200} />}><MountedWizard /></Suspense>; }
