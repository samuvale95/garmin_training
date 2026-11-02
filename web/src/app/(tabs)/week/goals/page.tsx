"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { safeReturnHref } from "@/lib/navigation";
import { PlusIcon, PencilIcon } from "@/components/Icons";
import { PlanNavigation, WorkspaceHeading } from "@/components/Workspace";
import { Skeleton } from "@/components/motion/primitives";
import { TrainingGoalForm } from "@/components/TrainingGoalForm";
import { GOAL_TYPES, useTrainingGoals, useGoalEvaluations, useEvaluateGoal, useSaveTrainingGoal, type TrainingGoal } from "@/lib/programDrafts";
import { usePlanListQuery } from "@/lib/queries";
import { useScreenReady } from "@/lib/useScreenReady";
import { formatFullDate } from "@/lib/format";
import { formatTargetTime } from "@/lib/raceGoal";
import { dis } from "@/lib/disabled";
const STATES:Record<string,string>={active:"Attivo",completed:"Concluso",archived:"Archiviato",insufficient_data:"Dati insufficienti",on_track:"In linea",needs_review:"Da rivedere",achieved:"Raggiunto"};
function GoalsContent(){
 const params=useSearchParams(),router=useRouter();const returnTo=safeReturnHref(params.get("returnTo"),"");
 const query=useTrainingGoals(),programs=usePlanListQuery();const[creating,setCreating]=useState(params.get("new")==="1"),[editing,setEditing]=useState<string|null>(params.get("edit"));useScreenReady(!query.isPending);
 return <div className="workspace-page"><WorkspaceHeading title="Piano" description="Obiettivi e valutazioni, anche senza una gara."/><PlanNavigation/><div className="ux-actions"><button className="ux-button ux-button-primary" data-track="goals.new" onClick={()=>setCreating(true)}><PlusIcon aria-hidden="true" />Nuovo obiettivo</button></div>{creating&&<TrainingGoalForm onSaved={(saved)=>{setCreating(false);if(returnTo){const next=new URL(returnTo,"https://passo.local");if(next.pathname==="/week/programs/new")next.searchParams.set("goalId",saved.id);router.push(`${next.pathname}${next.search}`);}}} onCancel={()=>{setCreating(false);if(returnTo)router.push(returnTo);}}/>}
 {query.isPending?<Skeleton height={150}/>:query.isError?<div className="ux-error" role="alert"><p>Non è stato possibile caricare gli obiettivi.</p><button className="ux-button" data-track="goals.retry" onClick={()=>query.refetch()} {...dis(query.isFetching,"in_caricamento")}>Riprova</button></div>:query.data?.goals.length?query.data.goals.map(goal=>editing===goal.id?<TrainingGoalForm key={goal.id} goal={goal} onSaved={()=>setEditing(null)} onCancel={()=>setEditing(null)}/>:<GoalCard key={goal.id} goal={goal} programs={programs.data?.plans.map(p=>({id:p.id,name:p.name}))??[]} onEdit={()=>setEditing(goal.id)}/>):<div className="ux-empty"><h2>In quale direzione vuoi andare?</h2><p>Puoi preparare una gara, migliorare una prestazione, allenare la forza o mantenere una frequenza sostenibile. Un programma libero può anche restare senza obiettivo.</p><button className="ux-button" data-track="goals.empty-new" onClick={()=>setCreating(true)}>Definisci un obiettivo</button></div>}</div>;
}
function GoalCard({goal,programs,onEdit}:{goal:TrainingGoal;programs:Array<{id:string;name:string}>;onEdit:()=>void}){
 const query=useGoalEvaluations(goal.id),evaluate=useEvaluateGoal(),save=useSaveTrainingGoal();const[showHistory,setShowHistory]=useState(false);
 return <article className="program-card"><div className="program-topline"><h2>{goal.name}</h2><span className="program-status" data-active={goal.status==="active"}>{STATES[goal.status]??goal.status}</span></div><p className="program-details">{GOAL_TYPES[goal.type]} · {goal.priority==="primary"?"Principale":"Secondario"}</p>{goal.description&&<p className="ux-muted">{goal.description}</p>}<dl className="goal-facts"><div><dt>{goal.type==="race"?"Tempo obiettivo":goal.type==="consistency"||goal.type==="maintenance"?"Criterio di riuscita":"Indicatore personale"}</dt><dd>{goal.type==="race"?(goal.target_time_seconds?formatTargetTime(goal.target_time_seconds):"Non indicato"):(goal.success_criterion?.metric === "sessions_per_week" ? "Sedute a settimana" : goal.success_criterion?.metric??"Da definire")}{goal.type!=="race"&&goal.success_criterion?.target!=null?`: ${goal.success_criterion.target} ${goal.success_criterion.unit??""}`:""}</dd></div><div><dt>Punto di partenza</dt><dd>{goal.baseline?.value!=null?`${goal.baseline.value} · ${goal.baseline.recorded_at?formatFullDate(goal.baseline.recorded_at):"Data non indicata"} · ${goal.baseline.source==="declared"?"Dichiarato":goal.baseline.source??"Fonte non indicata"}`:"Non disponibile"}</dd></div><div><dt>{goal.review_date?"Prossima revisione":"Scadenza"}</dt><dd>{goal.review_date||goal.deadline||goal.race_date?formatFullDate((goal.review_date??goal.deadline??goal.race_date)!):"Non prevista"}</dd></div><div><dt>Programmi collegati</dt><dd>{goal.linked_program_ids?.map(id=>programs.find(p=>p.id===id)?.name??"Programma conservato nello storico").join(", ")||"Nessuno. Collega l’obiettivo durante la creazione di un programma."}</dd></div></dl>
 <div className="ux-actions"><button className="ux-button" onClick={onEdit} data-track="goals.edit"><PencilIcon aria-hidden="true" />Modifica obiettivo</button><button className="ux-button" data-track="goals.evaluate" {...dis(evaluate.isPending,"in_caricamento")} onClick={()=>evaluate.mutate(goal.id)}>{evaluate.isPending?"Valuto…":"Aggiorna valutazione"}</button>{goal.type==="race"&&<Link className="ux-button" href={`/settings/goal?goalId=${encodeURIComponent(goal.id)}`} data-track="goals.race-prediction">Previsione della gara</Link>}{!goal.linked_program_ids?.length&&goal.status==="active"&&<Link className="ux-button" href={`/week/programs/new?goalId=${encodeURIComponent(goal.id)}`} data-track="goals.create-program">Crea programma per questo obiettivo</Link>}{goal.status==="active"&&<button className="ux-button" data-track="goals.archive" {...dis(save.isPending,"in_caricamento")} onClick={()=>save.mutate({id:goal.id,body:{expected_revision:goal.revision,status:"archived"}})}>Archivia obiettivo</button>}</div>{(evaluate.isError||save.isError)&&<p role="alert" className="ux-error">{(evaluate.error??save.error)?.message}</p>}
 <h3 className="ux-section-title">Valutazione del risultato</h3><p className="ux-muted">L’esecuzione del programma e il progresso verso il risultato sono misure diverse. Aggiornare la valutazione non modifica il calendario.</p>{query.isPending?<Skeleton height={80}/>:query.isError?<p className="ux-error" role="alert">Le valutazioni non sono disponibili.</p>:query.data?.evaluations.length?<><button className="ux-button" data-track="goals.evaluation-history" onClick={()=>setShowHistory(!showHistory)} aria-expanded={showHistory}>{showHistory?"Mostra ultima valutazione":"Mostra valutazioni precedenti"}</button>{(showHistory?query.data.evaluations:query.data.evaluations.slice(0,1)).map((evaluation,index)=><section className="goal-evaluation" key={evaluation.id??index}><h4>{STATES[evaluation.status]??evaluation.status}</h4><p className="program-details">{evaluation.evaluated_at||evaluation.created_at?new Date((evaluation.evaluated_at??evaluation.created_at)!).toLocaleString("it-IT"):"Data non disponibile"}</p>{evaluation.summary&&<p className="ux-muted">{evaluation.summary}</p>}{[["Esecuzione del programma",evaluation.execution],["Progresso verso il risultato",evaluation.progress],["Qualità dei dati",evaluation.quality]].map(([label,value])=><div key={String(label)}><strong>{String(label)}</strong><p className="program-details">{evaluationText(value)}</p></div>)}</section>)}</>:<div className="ux-notice"><strong>Dati insufficienti</strong><p>Nessuna valutazione registrata. Aggiungi un criterio misurabile e aggiorna la valutazione quando sono disponibili attività o test pertinenti.</p></div>}</article>;
}
function evaluationText(value:unknown):string{
 if(value==null)return "Dati non ancora disponibili.";
 if(typeof value==="string")return STATES[value]??value;
 if(typeof value!=="object")return String(value);
 const v=value as Record<string,unknown>;
 if(typeof v.summary==="string")return v.summary;
 if(typeof v.message==="string")return `${v.message}${typeof v.planned_sessions==="number"?` · ${v.planned_sessions} sedute pianificate`:""}${typeof v.recorded_activities==="number"?` · ${v.recorded_activities} attività registrate`:""}`;
 if(Array.isArray(v.missing_data))return v.missing_data.length?v.missing_data.map(String).join(" · "):"Nessun limite dei dati segnalato.";
 if(Array.isArray(v.evidence)){
   const prediction=v.evidence.find((item:unknown)=>item&&typeof item==="object"&&(item as Record<string,unknown>).metric==="race_prediction") as Record<string,unknown>|undefined;
   const assessment=prediction?.assessment as Record<string,unknown>|undefined;
   if(assessment&&typeof assessment.headline==="string")return assessment.headline;
   const frequency=v.evidence.find((item:unknown)=>item&&typeof item==="object"&&(item as Record<string,unknown>).metric==="sessions_per_week") as Record<string,unknown>|undefined;
   if(frequency&&typeof frequency.value==="number")return `${frequency.value} sedute a settimana nel periodo osservato · ${STATES[String(v.status)]??v.status}`;
   return STATES[String(v.status)]??"Non valutabile con i dati disponibili.";
 }
 return STATES[String(v.status)]??"Dati non ancora disponibili.";
}

export default function GoalsPage(){return <Suspense fallback={<Skeleton height={150}/>}><GoalsContent/></Suspense>;}
