"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useStoredActivities } from "@/lib/queries";
import { shiftDateKey, toDateKey } from "@/lib/sessionVisuals";
import { formatShortDate } from "@/lib/format";
import { useScreenReady } from "@/lib/useScreenReady";
import { dis } from "@/lib/disabled";
import { Skeleton } from "@/components/motion/primitives";
import { WorkspaceHeading } from "@/components/Workspace";

function ActivitiesView() {
  const params = useSearchParams();
  const pathname = usePathname();
  const period = ["30", "90", "365"].includes(params.get("days") ?? "") ? params.get("days")! : "30";
  const sport = params.get("sport") ?? "all";
  const search = params.get("q") ?? "";
  const today = toDateKey(new Date());
  const query = useStoredActivities(shiftDateKey(today, -(Number(period) - 1)), today);
  useScreenReady(!query.isPending);
  const activities = [...(query.data?.activities ?? [])].sort((a, b) => b.day.localeCompare(a.day) || (b.start_time ?? "").localeCompare(a.start_time ?? ""));
  const sports = [...new Map(activities.map((a) => [a.family, a.label])).entries()];
  const visible = activities.filter((a) => (sport === "all" || a.family === sport) && `${a.title} ${a.label}`.toLocaleLowerCase("it").includes(search.toLocaleLowerCase("it")));
  function filter(key: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    if (value && value !== "all") next.set(key, value); else next.delete(key);
    window.history.replaceState(null, "", `${pathname}${next.size ? `?${next}` : ""}`);
  }
  return <div className="workspace-page">
    <WorkspaceHeading title="Attività" description="Ritrova quello che hai fatto, segui i tuoi progressi." />
    <nav className="ux-actions" aria-label="Analisi delle attività">
      <Link className="ux-button" href="/coach?from=%2Factivities" data-track="activities.analysis">Tecnica e analisi</Link>
      <Link className="ux-button" href="/summary?from=%2Factivities" data-track="activities.summary">Resoconto settimanale</Link>
      <Link className="ux-button" href="/progress?from=%2Factivities" data-track="activities.progress">Continuità</Link>
    </nav>
    <div className="ux-filters">
      <label className="ux-field">Periodo<select value={period} onChange={(e) => filter("days", e.target.value)} data-track="activities.period"><option value="30">Ultimi 30 giorni</option><option value="90">Ultimi 90 giorni</option><option value="365">Ultimo anno</option></select></label>
      <label className="ux-field">Sport<select value={sport} onChange={(e) => filter("sport", e.target.value)} data-track="activities.sport"><option value="all">Tutti gli sport</option>{sports.map(([value, label]) => <option key={value} value={value}>{label}</option>)}{sport !== "all" && !sports.some(([value]) => value === sport) && <option value={sport}>{sport}</option>}</select></label>
      <label className="ux-field ux-search">Cerca un’attività<input type="search" placeholder="Nome o sport" value={search} onChange={(e) => filter("q", e.target.value)} data-track="activities.search" /></label>
    </div>
    {query.isPending ? <Skeleton height={180} /> : query.isError ? <div className="ux-error" role="alert"><p>Non è stato possibile caricare le attività.</p><button className="ux-button" onClick={() => query.refetch()} {...dis(query.isFetching, "in_caricamento")} data-track="activities.retry">Riprova</button></div> : <>
      <p className="ux-muted" aria-live="polite">{visible.length} attività nel periodo selezionato</p>
      {visible.length === 0 ? <div className="ux-empty"><h2>{activities.length ? "Nessun risultato" : "Il tuo storico inizia qui"}</h2><p>{activities.length ? "Prova un altro sport o cambia la ricerca." : "Le attività acquisite da Garmin e Strava compariranno qui. Puoi ampliare il periodo o controllare le connessioni."}</p><Link className="ux-button" href="/settings" data-track="activities.connections">Controlla connessioni</Link></div> : <ul className="activity-list">{visible.map((activity) => <li key={`${activity.source}-${activity.activity_id}`} className="activity-row">
        <div className="activity-row-header"><span>{activity.label}</span><time dateTime={activity.day}>{formatShortDate(activity.day)}</time></div>
        <h2>{activity.title || activity.label}</h2>
        <div className="activity-metrics"><span>{Math.round(activity.minutes)} min</span>{activity.distance_km != null && activity.distance_km > 0 && <span>{activity.distance_km.toLocaleString("it-IT", { maximumFractionDigits: 2 })} km</span>}</div>
        <p className="activity-meta">{activity.source === "garmin" ? "Garmin" : activity.source === "strava" ? "Strava" : "Dati stimati"}</p>
      </li>)}</ul>}
    </>}
  </div>;
}

export default function ActivitiesPage() {
  return <Suspense fallback={<div className="workspace-page"><Skeleton height={240} /></div>}><ActivitiesView /></Suspense>;
}
