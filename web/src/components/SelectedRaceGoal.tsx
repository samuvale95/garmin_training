"use client";
import { PencilIcon as ActionEdit } from "@/components/Icons";

import { TargetIcon as ScreenSymbol } from "@/components/Icons";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/motion/primitives";
import { useEvaluateGoal, useGoalEvaluations, useTrainingGoals } from "@/lib/programDrafts";
import { usePlanListQuery } from "@/lib/queries";
import { useScreenReady } from "@/lib/useScreenReady";
import { formatFullDate } from "@/lib/format";
import { formatTargetTime } from "@/lib/raceGoal";
import { dis } from "@/lib/disabled";
import { raceAssessment, selectRaceGoal } from "@/lib/selectedRaceGoal";

function duration(value: unknown): string | null {
  return typeof value === "number" && value > 0 ? formatTargetTime(value) : null;
}

export function SelectedRaceGoal({ goalId }: { goalId: string }) {
  const goals = useTrainingGoals();
  const programs = usePlanListQuery();
  const evaluations = useGoalEvaluations(goalId);
  const evaluate = useEvaluateGoal();
  const goal = selectRaceGoal(goals.data?.goals, goalId);
  useScreenReady(!goals.isPending && (!goal || !evaluations.isPending));
  if (goals.isPending || (goal && evaluations.isPending)) return <div className="workspace-page"><Skeleton height={180} /></div>;
  if (goals.isError) return <div className="workspace-page"><p role="alert" className="ux-error">Non riesco a caricare la gara.</p></div>;
  if (!goal) return <div className="workspace-page"><PageHeader backHref="/week/goals" /><h1>Gara non trovata</h1><p>Apri l’elenco degli obiettivi e scegli una gara.</p></div>;

  const latest = evaluations.data?.evaluations[0];
  const stale = latest?.goal_revision != null && latest.goal_revision !== goal.revision;
  const prediction = stale ? null : raceAssessment(latest?.progress?.evidence, "race_prediction");
  const fit = stale ? null : raceAssessment(latest?.progress?.evidence, "race_plan_fit");
  const low = duration(prediction?.predicted_low_seconds);
  const high = duration(prediction?.predicted_high_seconds);
  const predicted = low && high ? `${low}–${high}` : duration(prediction?.predicted_time_seconds);
  const linked = goal.linked_program_ids?.map(id => programs.data?.plans.find(plan => plan.id === id)?.name ?? "Programma conservato nello storico") ?? [];

  return <div className="workspace-page">
    <PageHeader backHref="/week/goals" />
    <h1 className="icon-heading"><ScreenSymbol aria-hidden="true" />{goal.name}</h1>
    <p className="program-details">{goal.race_date ? formatFullDate(goal.race_date) : "Data non indicata"} · {goal.distance_km ?? "—"} km{goal.target_time_seconds ? ` · obiettivo ${formatTargetTime(goal.target_time_seconds)}` : ""}</p>
    <p className="ux-muted">Programmi collegati: {linked.length ? linked.join(", ") : "nessuno"}. La previsione considera questa gara, le attività disponibili e solo le sedute dei programmi collegati.</p>
    <div className="ux-actions"><Link className="ux-button" href={`/week/goals?edit=${encodeURIComponent(goal.id)}`} data-track="settings.goal.edit-selected"><ActionEdit className="action-symbol" aria-hidden="true" />Modifica obiettivo</Link><button className="ux-button ux-button-primary" data-track="settings.goal.evaluate-selected" {...dis(evaluate.isPending,"in_caricamento")} onClick={() => evaluate.mutate(goal.id)}>{evaluate.isPending ? "Aggiorno…" : "Aggiorna previsione"}</button></div>
    {evaluate.isError && <p role="alert" className="ux-error">{evaluate.error.message}</p>}
    {evaluations.isError && <p role="alert" className="ux-error">Non riesco a caricare la previsione.</p>}
    {!latest && !evaluations.isError && <div className="ux-notice"><strong>Previsione non ancora calcolata</strong><p>Aggiornala per usare attività e programmi disponibili.</p></div>}
    {stale && <div className="ux-notice"><strong>Obiettivo modificato dopo l’ultima valutazione</strong><p>Aggiorna la previsione per includere i dati attuali della gara.</p></div>}
    {latest && !stale && <>
      <section className="program-card"><h2 className="icon-heading"><ScreenSymbol aria-hidden="true" />Previsione della gara</h2>{prediction ? <><p>{typeof prediction.headline === "string" ? prediction.headline : "Stima non disponibile"}</p>{predicted && <p className="program-details">Tempo previsto: {predicted}</p>}{typeof prediction.summary === "string" && <p className="ux-muted">{prediction.summary}</p>}{typeof prediction.prediction_basis === "string" && <p className="ux-muted">Base della stima: {prediction.prediction_basis}</p>}</> : <p className="ux-muted">Questa valutazione non contiene una previsione della gara. Aggiornala.</p>}<p className="ux-muted">Una stima non conferma il risultato effettivo della gara.</p></section>
      <section className="program-card"><h2 className="icon-heading"><ScreenSymbol aria-hidden="true" />Programmi collegati e preparazione</h2>{fit ? <><p>{typeof fit.headline === "string" ? fit.headline : "Valutazione del programma non disponibile"}</p>{typeof fit.sessions_ahead === "number" && <p className="program-details">Sedute previste prima della gara: {fit.sessions_ahead}</p>}</> : <p className="ux-muted">Nessuna analisi del programma in questa valutazione.</p>}{linked.length === 0 && <p className="ux-muted">Collega un programma per valutare le sedute rispetto alla gara.</p>}</section>
      {Array.isArray(latest.quality?.missing_data) && latest.quality.missing_data.length > 0 && <section className="ux-notice"><h2>Limiti dei dati</h2>{latest.quality.missing_data.map((message, index) => <p key={index}>{String(message)}</p>)}</section>}
    </>}
  </div>;
}
