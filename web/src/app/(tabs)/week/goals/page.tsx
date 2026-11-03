"use client";
import { PencilIcon as ActionEdit, SyncIcon as ActionSync } from "@/components/Icons";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { safeReturnHref } from "@/lib/navigation";
import { PlusIcon, PencilIcon, TrashIcon } from "@/components/Icons";
import { PlanNavigation, WorkspaceHeading } from "@/components/Workspace";
import { Skeleton } from "@/components/motion/primitives";
import { TrainingGoalForm } from "@/components/TrainingGoalForm";
import { GOAL_TYPES, useTrainingGoals, useGoalEvaluations, useEvaluateGoal, useSaveTrainingGoal, useDeleteTrainingGoal, type TrainingGoal } from "@/lib/programDrafts";
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
 {query.isPending?<Skeleton height={150}/>:query.isError?<div className="ux-error" role="alert"><p>Non è stato possibile caricare gli obiettivi.</p><button className="ux-button" data-track="goals.retry" onClick={()=>query.refetch()} {...dis(query.isFetching,"in_caricamento")}><ActionSync className="action-symbol" aria-hidden="true" />Riprova</button></div>:query.data?.goals.length?query.data.goals.map(goal=>editing===goal.id?<TrainingGoalForm key={goal.id} goal={goal} onSaved={()=>setEditing(null)} onCancel={()=>setEditing(null)}/>:<GoalCard key={goal.id} goal={goal} programs={programs.data?.plans.map(p=>({id:p.id,name:p.name}))??[]} onEdit={()=>setEditing(goal.id)}/>):<div className="ux-empty"><h2>In quale direzione vuoi andare?</h2><p>Puoi preparare una gara, migliorare una prestazione, allenare la forza o mantenere una frequenza sostenibile. Un programma libero può anche restare senza obiettivo.</p><button className="ux-button" data-track="goals.empty-new" onClick={()=>setCreating(true)}>Definisci un obiettivo</button></div>}</div>;
}
function GoalCard({goal,programs,onEdit}:{goal:TrainingGoal;programs:Array<{id:string;name:string}>;onEdit:()=>void}){
  const query=useGoalEvaluations(goal.id),evaluate=useEvaluateGoal(),save=useSaveTrainingGoal(),del=useDeleteTrainingGoal();
  const[showHistory,setShowHistory]=useState(false);
  const[confirmDelete,setConfirmDelete]=useState(false);

  return <article className="program-card">
    <div className="program-topline">
      <h2>{goal.name}</h2>
      <span className="program-status" data-active={goal.status==="active"}>{STATES[goal.status]??goal.status}</span>
    </div>
    <p className="program-details">
      {GOAL_TYPES[goal.type]} · {goal.priority==="primary"?"Principale":"Secondario"}
      {goal.distance_km != null ? ` · ${goal.distance_km} km` : ""}
      {goal.elevation_gain_m != null ? ` · D+ ${goal.elevation_gain_m} m` : ""}
    </p>
    {goal.description&&<p className="ux-muted">{goal.description}</p>}

    <dl className="goal-facts">
      {goal.type === "race" && (
        <div>
          <dt>Dettagli gara</dt>
          <dd>
            {goal.race_date ? formatFullDate(goal.race_date) : "Data non indicata"}
            {goal.distance_km != null ? ` · ${goal.distance_km} km` : ""}
            {goal.elevation_gain_m != null ? ` · D+ ${goal.elevation_gain_m} m` : ""}
            {goal.target_time_seconds ? ` · Obiettivo ${formatTargetTime(goal.target_time_seconds)}` : " · Senza tempo obiettivo"}
          </dd>
        </div>
      )}

      {(goal.type === "consistency" || goal.type === "maintenance") && (
        <div>
          <dt>Frequenza</dt>
          <dd>
            {goal.success_criterion?.target != null ? `${goal.success_criterion.target} sedute a settimana` : "Frequenza libera"}
          </dd>
        </div>
      )}

      {goal.type !== "race" && (goal.review_date || goal.deadline) && (
        <div>
          <dt>Data prevista</dt>
          <dd>{formatFullDate((goal.review_date ?? goal.deadline)!)}</dd>
        </div>
      )}

      <div>
        <dt>Programmi collegati</dt>
        <dd>{goal.linked_program_ids?.map(id=>programs.find(p=>p.id===id)?.name??"Programma conservato").join(", ")||"Nessuno collegato al momento."}</dd>
      </div>
    </dl>

    <div className="ux-actions">
      <button className="ux-button" onClick={onEdit} data-track="goals.edit"><PencilIcon aria-hidden="true" /><ActionEdit className="action-symbol" aria-hidden="true" />Modifica</button>
      {goal.type==="race"&&<Link className="ux-button" href={`/settings/goal?goalId=${encodeURIComponent(goal.id)}`} data-track="goals.race-prediction">Previsione gara</Link>}
      {!goal.linked_program_ids?.length&&goal.status==="active"&&<Link className="ux-button" href={`/week/programs/new?goalId=${encodeURIComponent(goal.id)}`} data-track="goals.create-program">Crea programma per questo obiettivo</Link>}
      {goal.status==="active"&&<button className="ux-button" data-track="goals.archive" {...dis(save.isPending,"in_caricamento")} onClick={()=>save.mutate({id:goal.id,body:{expected_revision:goal.revision,status:"archived"}})}>Archivia</button>}
      <button className="ux-button" style={{color:"var(--rosso-avviso)"}} data-track="goals.delete" {...dis(del.isPending,"in_caricamento")} onClick={()=>setConfirmDelete(true)}><TrashIcon aria-hidden="true" />Elimina obiettivo</button>
    </div>

    {confirmDelete && (
      <div className="ux-notice" role="dialog" aria-modal="false" aria-labelledby="delete-goal-title">
        <h4 id="delete-goal-title">Eliminare definitivamente “{goal.name}”?</h4>
        <p>L’obiettivo verrà rimosso. I programmi e le sedute già nel calendario non verranno cancellati.</p>
        <div className="ux-actions">
          <button
            className="ux-button"
            style={{background:"var(--rosso-avviso)",color:"#fff"}}
            {...dis(del.isPending,"in_caricamento")}
            onClick={()=>{del.mutate(goal.id);setConfirmDelete(false);}}
          >
            {del.isPending ? "Elimino…" : "Conferma eliminazione"}
          </button>
          <button className="ux-button" onClick={()=>setConfirmDelete(false)}>Annulla</button>
        </div>
      </div>
    )}

    {(evaluate.isError||save.isError||del.isError)&&<p role="alert" className="ux-error">{(evaluate.error??save.error??del.error)?.message}</p>}
  </article>;
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
