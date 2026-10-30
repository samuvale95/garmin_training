"use client";

import { Suspense, type CSSProperties } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useStoredActivities } from "@/lib/queries";
import { shiftDateKey, toDateKey } from "@/lib/sessionVisuals";
import { formatMinutes } from "@/lib/format";
import { useScreenReady } from "@/lib/useScreenReady";
import { dis } from "@/lib/disabled";
import { Skeleton } from "@/components/motion/primitives";
import { WorkspaceHeading } from "@/components/Workspace";
import { DateLead, EmptyState, RowLink, Section } from "@/components/ui";
import type { StoredActivity } from "@/lib/types";

const VIEWS = [
  ["history", "Storico"],
  ["trend", "Andamento"],
  ["reports", "Resoconti"],
] as const;
type View = (typeof VIEWS)[number][0];

const FAMILY_COLOR: Record<string, string> = {
  run: "var(--sport-run)",
  ride: "var(--sport-bike)",
  swim: "var(--sport-easy)",
  strength: "var(--sport-strength)",
  hike: "var(--sport-long)",
  walk: "var(--sport-rest)",
};

const SOURCE_LABEL: Record<StoredActivity["source"], string> = { garmin: "Garmin", strava: "Strava", stima: "Valori stimati" };

/** Attività: what was done and how it is going. One place for the history, the
 * analyses (formerly behind "Coach" and "Tecnica") and the weekly reports. */
function ActivitiesView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const view: View = (VIEWS.find(([key]) => key === params.get("view"))?.[0]) ?? "history";
  const here = `${pathname}${params.size ? `?${params}` : ""}`;

  function setParam(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== defaultValue) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  }

  return (
    <div className="page">
      <WorkspaceHeading title="Attività" description="Ritrova quello che hai fatto e come sta andando." />
      <nav className="subnav" aria-label="Sezioni delle attività">
        {VIEWS.map(([key, label]) => (
          <a
            key={key}
            href={key === "history" ? "/activities" : `/activities?view=${key}`}
            aria-current={view === key ? "page" : undefined}
            data-track={`activities.view-${key}`}
            onClick={(event) => {
              event.preventDefault();
              setParam("view", key, "history");
            }}
          >
            {label}
          </a>
        ))}
      </nav>
      {view === "history" ? <History setParam={setParam} here={here} /> : view === "trend" ? <Trend here={here} /> : <Reports here={here} />}
    </div>
  );
}

function History({ setParam, here }: { setParam: (key: string, value: string, defaultValue: string) => void; here: string }) {
  const params = useSearchParams();
  const period = ["30", "90", "365"].includes(params.get("days") ?? "") ? params.get("days")! : "30";
  const sport = params.get("sport") ?? "all";
  const search = params.get("q") ?? "";
  const today = toDateKey(new Date());
  const query = useStoredActivities(shiftDateKey(today, -(Number(period) - 1)), today);
  useScreenReady(!query.isPending, "/activities");
  const activities = [...(query.data?.activities ?? [])].sort((a, b) => b.day.localeCompare(a.day) || (b.start_time ?? "").localeCompare(a.start_time ?? ""));
  const sports = [...new Map(activities.map((a) => [a.family, a.label])).entries()];
  const needle = search.trim().toLocaleLowerCase("it");
  const visible = activities.filter((a) => (sport === "all" || a.family === sport) && `${a.title} ${a.label}`.toLocaleLowerCase("it").includes(needle));
  const totalMinutes = visible.reduce((sum, a) => sum + a.minutes, 0);

  // Group by month: the list is long, and months are how a past run is remembered.
  const groups = new Map<string, StoredActivity[]>();
  for (const activity of visible) {
    const month = new Date(`${activity.day}T12:00:00`).toLocaleDateString("it-IT", { month: "long", year: "numeric" });
    groups.set(month, [...(groups.get(month) ?? []), activity]);
  }

  return (
    <>
      <div className="ux-filters">
        <label className="field">
          Periodo
          <select value={period} onChange={(e) => setParam("days", e.target.value, "30")} data-track="activities.period">
            <option value="30">Ultimi 30 giorni</option>
            <option value="90">Ultimi 90 giorni</option>
            <option value="365">Ultimo anno</option>
          </select>
        </label>
        <label className="field">
          Sport
          <select value={sport} onChange={(e) => setParam("sport", e.target.value, "all")} data-track="activities.sport">
            <option value="all">Tutti gli sport</option>
            {sports.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {sport !== "all" && !sports.some(([value]) => value === sport) && <option value={sport}>{sport}</option>}
          </select>
        </label>
        <label className="field ux-search">
          Cerca
          <input type="search" placeholder="Nome o sport" value={search} onChange={(e) => setParam("q", e.target.value, "")} data-track="activities.search" />
        </label>
      </div>

      {query.isPending ? (
        <Skeleton height={240} radius={16} />
      ) : query.isError ? (
        <div className="ux-error" role="alert">
          <p>Non è stato possibile caricare le attività.</p>
          <button className="btn" data-size="sm" onClick={() => query.refetch()} {...dis(query.isFetching, "in_caricamento")} data-track="activities.retry">Riprova</button>
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={activities.length ? "Nessun risultato" : "Il tuo storico inizia qui"}
          actions={activities.length ? undefined : <Link className="btn" href="/settings" data-track="activities.connections">Controlla le connessioni</Link>}
        >
          {activities.length
            ? "Prova un altro sport, un periodo più lungo o un’altra ricerca."
            : "Le attività acquisite da Garmin e Strava compariranno qui, anche quelle fuori dal piano."}
        </EmptyState>
      ) : (
        <>
          <p className="muted" aria-live="polite" style={{ margin: "0 0 16px", fontSize: "var(--text-sm)" }}>
            <span className="figure">{visible.length}</span> {visible.length === 1 ? "attività" : "attività"} · <span className="figure">{formatMinutes(totalMinutes)}</span> in totale
          </p>
          <div className="stack-lg">
            {[...groups.entries()].map(([month, items]) => (
              <Section key={month} title={<span style={{ textTransform: "capitalize" }}>{month}</span>}>
                <ul className="list">
                  {items.map((activity) => (
                    <li key={`${activity.source}-${activity.activity_id}`}>
                      <div className="row activity-row">
                        <DateLead date={activity.day} />
                        <span className="sport-mark" aria-hidden="true" style={{ "--sport": FAMILY_COLOR[activity.family] ?? "var(--sport-rest)" } as CSSProperties} />
                        <span className="row-main">
                          <span className="row-title">{activity.title || activity.label}</span>
                          <span className="row-meta">
                            {activity.label} · {SOURCE_LABEL[activity.source]}
                          </span>
                        </span>
                        <span className="row-end figure" style={{ flexDirection: "column", alignItems: "flex-end", gap: 0, color: "var(--ink)" }}>
                          <span>{formatMinutes(activity.minutes)}</span>
                          {activity.distance_km != null && activity.distance_km > 0 && (
                            <span style={{ color: "var(--ink-2)" }}>{activity.distance_km.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km</span>
                          )}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 20, fontSize: "var(--text-sm)" }}>
            Le analisi di ogni corsa sono in <Link href={`/coach?from=${encodeURIComponent(here)}`} data-track="activities.analysis-inline">Andamento</Link>.
          </p>
        </>
      )}
    </>
  );
}

function Trend({ here }: { here: string }) {
  useScreenReady(true, "/activities");
  const from = here;
  return (
    <div className="stack-lg">
      <Section title="Analisi della corsa">
        <ul className="list">
          <li><RowLink href="/coach" from={from} track="activities.analysis" title="Tecnica" meta="Cadenza, contatto al suolo e ritmi delle ultime corse" /></li>
          <li><RowLink href="/coach/esecuzione" from={from} track="activities.execution" title="Come hai eseguito il piano" meta="Previsto ed eseguito a confronto, seduta per seduta" /></li>
          <li><RowLink href="/coach/allenarsi" from={from} track="activities.habits" title="Come ti alleni" meta="Distribuzione delle intensità e abitudini" /></li>
        </ul>
      </Section>
      <Section title="Carico">
        <ul className="list">
          <li><RowLink href="/body/load" track="activities.load" title="Carico e forma" meta="Ultime 4 settimane, con spiegazione delle sigle" /></li>
        </ul>
      </Section>
      <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)", maxWidth: "62ch" }}>
        Ogni analisi distingue i valori misurati dalle stime. Una correlazione indica che due cose cambiano insieme, non che una causi l’altra.
      </p>
    </div>
  );
}

function Reports({ here }: { here: string }) {
  useScreenReady(true, "/activities");
  return (
    <div className="stack-lg">
      <Section title="Resoconti">
        <ul className="list">
          <li><RowLink href="/summary" from={here} track="activities.summary" title="Resoconto della settimana" meta="Cosa hai fatto rispetto al previsto, la settimana scorsa" /></li>
          <li><RowLink href="/progress" from={here} track="activities.progress" title="Continuità" meta="Settimane di fila, punti e traguardi" /></li>
          <li><RowLink href="/week/goals" track="activities.goals" title="Obiettivi" meta="Valutazioni datate verso i tuoi obiettivi" /></li>
        </ul>
      </Section>
    </div>
  );
}

export default function ActivitiesPage() {
  return (
    <Suspense fallback={<div className="page"><Skeleton height={240} radius={16} /></div>}>
      <ActivitiesView />
    </Suspense>
  );
}
