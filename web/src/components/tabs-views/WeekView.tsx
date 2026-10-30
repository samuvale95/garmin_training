"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PlanNavigation, WorkspaceHeading } from "@/components/Workspace";
import { dis } from "@/lib/disabled";
import { ChevronLeft, ChevronRight, PlusIcon } from "@/components/Icons";
import { EmptyState, Notice } from "@/components/ui";
import { DraggableWeekCard, RestCard, type DayCardData } from "@/components/WeekCards";
import { OffPlanCard, offPlanActivities } from "@/components/OffPlanCard";
import { useMotionEnabled } from "@/lib/motion";
import { useMoveSession } from "@/lib/moveWarnings";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useCalendarAccess } from "@/lib/guards";
import {
  useActivities,
  usePrefetchWeeks,
  usePrefetchWorkoutSession,
  useRefreshServerData,
  useRescheduleWorkout,
  useStravaActivityMatches,
  useStravaStatus,
  useIsRewritten,
  useStoredActivities,
  useWeekWorkouts,
} from "@/lib/queries";
import { SkeletonDayCards } from "@/components/skeletons";
import { sessionDistanceKm, sessionDurationMinutes, toDateKey, weekBounds, weekOffsetFromToday } from "@/lib/sessionVisuals";
import type { TrainingSession } from "@/lib/types";
import { formatMinutes, formatShortDate } from "@/lib/format";
import { useScreenReady } from "@/lib/useScreenReady";

function formatWeekRange(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("it-IT", { month: "short" });
  const endMonth = end.toLocaleDateString("it-IT", { month: "short" });
  if (startMonth === endMonth) return `${start.getDate()} – ${end.getDate()} ${endMonth}`;
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}`;
}

/** Distance from the viewport edge at which carrying a card starts scrolling the page,
 * and the fastest it scrolls (px per frame) once the finger is right at the edge. */
const AUTOSCROLL_EDGE_PX = 92;
const AUTOSCROLL_MAX_PX = 13;

function haptic(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

export function WeekPageContent() {
  const access = useCalendarAccess({ redirectWhenEmpty: false });
    const { reduced } = useMotionEnabled();
  // `?date=` opens on the week containing that day instead of the current one -- how the
  // editor comes back after a save. Paging updates the same URL state, so detail links,
  // reloads and browser history all retain the selected week.
  const calendarParams = useSearchParams();
  const focusDate = calendarParams.get("date");
  const calendarView = calendarParams.get("view") === "list" ? "list" : "columns";
  const router = useRouter();
  const rawOffset = focusDate ? weekOffsetFromToday(focusDate) : 0;
  const offset = Number.isFinite(rawOffset) ? rawOffset : 0;
  // -1 / +1: which side the day list should enter from after a week change.
  const [direction, setDirection] = useState(0);
  const liveMode = !access.plan && access.garminConnected;
  const todayKey = toDateKey(new Date());

  const reference = new Date();
  reference.setDate(reference.getDate() + offset * 7);
  const { start, end } = weekBounds(reference);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const workoutsQuery = useWeekWorkouts(reference, liveMode);
  // Real done-vs-planned needs actual Garmin activities, not just the scheduled/planned
  // calendar -- only fetched (and only shown) when there's both a plan to compare
  // against and a live Garmin connection to pull completed activities from.
  const showProgress = !liveMode && access.garminConnected;
  const activitiesQuery = useActivities(startKey, endKey, showProgress);
  // Everything done this week, from the stored history (all sports, Strava-only too):
  // what falls outside the plan is shown in its day.
  const storedActivities = useStoredActivities(startKey, endKey, access.ready);

  // "Svolto" indicators on day cards: plan sessions already have the shape the batch
  // endpoint expects; a liveMode ScheduledWorkout (date/sport/title, no steps) is
  // turned into an equivalent synthetic session with empty steps -- harmless, since
  // matching only needs date/sport and steps only feed the "planned" side, which a
  // live Garmin workout doesn't have anyway.
  const stravaStatus = useStravaStatus();
  const planSessions: TrainingSession[] = access.plan
    ? access.plan.sessions.filter((s) => s.date >= startKey && s.date <= endKey)
    : (workoutsQuery.data?.workouts ?? []).map((w) => ({
        date: w.date,
        sport: w.sport as TrainingSession["sport"],
        title: w.title,
        description: null,
        steps: [],
      }));
  // The weeks either side of this one, warmed while the user is reading this one --
  // paging is then instant on the first visit too, not only on the way back through
  // the cache. Nothing is fetched for a week already held (prefetch honours staleTime).
  const neighbouringWeeks = [-1, 1].map((step) => {
    const neighbour = new Date(reference);
    neighbour.setDate(neighbour.getDate() + step * 7);
    return neighbour;
  });
  usePrefetchWeeks(neighbouringWeeks, { workouts: liveMode, activities: showProgress });

  const stravaEnabled = !!stravaStatus.data?.connected && planSessions.length > 0;
  const stravaMatches = useStravaActivityMatches(planSessions, stravaEnabled);
  const prefetchWorkoutSession = usePrefetchWorkoutSession();
  const moveSession = useMoveSession();
  const rescheduleWorkout = useRescheduleWorkout();
  // While the server rewrites the next weeks, their days hold still: a move made now
  // would race the generation, and the plan adopted when it finishes could hide it.
  const { rewriting, until: rewriteUntil, isRewritten } = useIsRewritten();

  // Drag target detection for the day cards below: each day row registers itself here
  // by key, and the carried card's position is tested against every row's rect to find
  // which day it is over -- cheaper than a real DnD library for a plain "move to this
  // day" gesture, and keeps the list a plain vertical stack (no reordering *within* a
  // day).
  const dayRowRefs = useRef(new Map<string, HTMLDivElement | null>());
  // State, not a ref: the list is only rendered once the screen knows it has something
  // to show, so the effect that attaches the touch listeners below has to re-run when
  // the element appears -- a ref would still be null on the one pass it made.
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [carried, setCarried] = useState<DayCardData | null>(null);
  const [hoverDayKey, setHoverDayKey] = useState<string | null>(null);
  // Read from listeners that must not re-subscribe on every drag frame.
  const carriedRef = useRef(false);
  const hoverKeyRef = useRef<string | null>(null);
  const pointerPageY = useRef<number | null>(null);
  const swipeHandled = useRef(false);

  const dayKeyAtPageY = useCallback((pageY: number): string | null => {
    for (const [key, el] of dayRowRefs.current) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (pageY >= rect.top + window.scrollY && pageY <= rect.bottom + window.scrollY) return key;
    }
    return null;
  }, []);

  const handleDragOver = useCallback(
    (pageY: number) => {
      pointerPageY.current = pageY;
      const key = dayKeyAtPageY(pageY);
      if (key === hoverKeyRef.current) return;
      hoverKeyRef.current = key;
      setHoverDayKey(key);
      // A short tick every time the card crosses into another day: the drop target is
      // under the finger, where it can't be seen.
      if (key) haptic(6);
    },
    [dayKeyAtPageY]
  );

  const handleDragStateChange = useCallback((card: DayCardData, dragging: boolean) => {
    carriedRef.current = dragging;
    setCarried(dragging ? card : null);
    if (!dragging) {
      hoverKeyRef.current = null;
      pointerPageY.current = null;
      setHoverDayKey(null);
    }
  }, []);

  function handleCardDrop(card: DayCardData, pageY: number) {
    const targetKey = dayKeyAtPageY(pageY);
    if (!targetKey || targetKey === card.session.date) return;
    if (isRewritten(targetKey) || isRewritten(card.session.date)) {
      haptic([30, 30, 30]);
      return;
    }
    haptic([10, 40, 14]);
    if (card.planId != null) {
      moveSession(card.planId, card.session.date, targetKey);
    } else if (card.workout) {
      rescheduleWorkout.mutate({ workout: card.workout, newDate: targetKey });
    }
  }

  const pageWeek = useCallback((delta: number) => {
    setDirection(delta);
    const date = new Date();
    date.setDate(date.getDate() + (offset + delta) * 7);
    router.replace(`/week?date=${toDateKey(weekBounds(date).start)}`, { scroll: false });
  }, [offset, router]);

  // One non-passive touch listener owns both gestures the list has to arbitrate.
  //
  // Carrying a card must not scroll the page under it: `touch-action: none` on the card
  // itself would be the one-liner, but it also costs the user the ability to scroll the
  // week by swiping over a card -- which is most of the screen.
  //
  // A sideways swipe pages between weeks (nobody reaches for the ‹ › buttons on a
  // phone). It is read from touch events rather than pointer events because a
  // horizontal drag on a vertically scrolling page is a pan as far as the browser is
  // concerned: it takes the gesture over and delivers `pointercancel` instead of
  // `pointerup`, and on some devices runs its own back-navigation with it. Cancelling
  // the touch once the swipe is unmistakably horizontal takes it back -- the page never
  // Prevent page scroll when actively dragging/carrying a workout card to move it
  useEffect(() => {
    const el = listEl;
    if (!el) return;

    const onTouchMove = (event: TouchEvent) => {
      if (carriedRef.current) {
        if (event.cancelable) event.preventDefault();
      }
    };

    el.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      el.removeEventListener("touchmove", onTouchMove);
    };
  }, [listEl]);

  // ...but a card carried to the top or bottom edge does need the page to follow, or
  // days off-screen can't be reached at all on a short viewport.
  useEffect(() => {
    if (!carried) return;
    let frameId = 0;
    const step = () => {
      const pageY = pointerPageY.current;
      if (pageY != null) {
        const viewportY = pageY - window.scrollY;
        let delta = 0;
        if (viewportY < AUTOSCROLL_EDGE_PX) {
          delta = -AUTOSCROLL_MAX_PX * (1 - Math.max(0, viewportY) / AUTOSCROLL_EDGE_PX);
        } else if (viewportY > window.innerHeight - AUTOSCROLL_EDGE_PX) {
          delta = AUTOSCROLL_MAX_PX * (1 - Math.max(0, window.innerHeight - viewportY) / AUTOSCROLL_EDGE_PX);
        }
        if (delta !== 0) window.scrollBy(0, delta);
      }
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [carried]);

  function goToCurrentWeek() {
    setDirection(offset > 0 ? -1 : 1);
    router.replace("/week", { scroll: false });
  }

  const refreshMutation = useRefreshServerData();
  // Ready also with neither plan nor Garmin: the empty state below offers the choices.
  useScreenReady(access.ready && !(liveMode && workoutsQuery.isPending), "/week");

  const header = (
    <>
      <WorkspaceHeading title="Piano">
        <AddMenu />
      </WorkspaceHeading>
      <PlanNavigation />
      <WeekNav start={start} end={end} offset={offset} onPrev={() => pageWeek(-1)} onNext={() => pageWeek(1)} onToday={goToCurrentWeek} />
    </>
  );

  if (!access.ready) {
    return (
      <div className="page">
        {header}
        <SkeletonDayCards />
      </div>
    );
  }

  if (!access.plan && !access.garminConnected) {
    return (
      <div className="page">
        <WorkspaceHeading title="Piano" />
        <PlanNavigation />
        <EmptyState
          title="Costruisci la tua settimana"
          actions={
            <>
              <Link className="btn" data-variant="primary" href="/week/programs/new" data-track="week.empty-programs">Nuovo programma</Link>
              <Link className="btn" href="/week/new?from=%2Fweek" data-track="week.empty-single">Allenamento singolo</Link>
              <Link className="btn" href="/connect-garmin" data-track="week.empty-connect">Collega Garmin</Link>
            </>
          }
        >
          Crea un programma con AI, importa un file oppure collega Garmin per consultare il calendario che hai già.
        </EmptyState>
      </div>
    );
  }

  const days = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    const cards: DayCardData[] = access.plan
      ? access.plan.sessions
          .filter((session) => session.date === key && session.id)
          .map((session) => ({ id: `plan:${session.id}`, session, planId: session.id }))
      : liveMode
        ? (workoutsQuery.data?.workouts ?? [])
            .filter((w) => w.date === key)
            .map((w) => ({ id: `garmin:${w.scheduled_workout_id}`, session: w, workout: w }))
        : [];
    const offPlan = offPlanActivities(
      (storedActivities.data?.activities ?? []).filter((a) => a.day === key),
      cards.map((card) => card.session.sport)
    );
    return { date, key, cards, offPlan };
  });

  const weekSessions = days.flatMap((d) => d.cards.map((c) => c.session));
  const weekKm = weekSessions.reduce((sum, s) => sum + sessionDistanceKm(s), 0);
  const weekMinutes = weekSessions.reduce((sum, s) => sum + sessionDurationMinutes(s), 0);
  const doneKm = (activitiesQuery.data?.activities ?? []).reduce((sum, a) => sum + (a.distance_km ?? 0), 0);
  const progressFraction = weekKm > 0 ? Math.min(1, doneKm / weekKm) : 0;

  // The session the week is waiting on: today's, unless it is already done, else the
  // next one this week. Only on the current week -- elsewhere nothing is "next".
  const doneToday = (storedActivities.data?.activities ?? []).some((a) => a.day === todayKey && a.family !== "walk");
  const nextDayKey =
    offset === 0
      ? days.find((d) => d.cards.length > 0 && (doneToday ? d.key > todayKey : d.key >= todayKey))?.key ?? null
      : null;
  const weekInClass = reduced || direction === 0 ? undefined : "anim-week-in";

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div className="page">
        {header}

        <div className="week-summary">
          <span>
            <strong className="figure">{weekSessions.length}</strong> {weekSessions.length === 1 ? "seduta" : "sedute"}
            {weekMinutes > 0 && <> · <span className="figure">{formatMinutes(weekMinutes)}</span> previste</>}
            {liveMode && " · calendario Garmin"}
          </span>
          {showProgress && weekKm > 0 && (
            <>
              <span className="week-progress" role="img" aria-label={`Corsa: ${doneKm.toFixed(0)} km svolti su ${weekKm.toFixed(0)} previsti`}>
                <span style={{ width: `${progressFraction * 100}%` }} />
              </span>
              <span className="figure">{doneKm.toFixed(0)} / {weekKm.toFixed(0)} km di corsa e bici</span>
            </>
          )}
          {offset <= 0 && (
            <Link data-track="week.summary-monday-startkey" href={`/summary?monday=${startKey}&from=%2Fweek`} className="section-link">
              Resoconto della settimana
            </Link>
          )}
          <span className="calendar-view-switch subnav" role="group" aria-label="Vista calendario" style={{ margin: "0 0 0 auto" }}>
            <button type="button" aria-pressed={calendarView === "columns"} data-track="week.columns" onClick={() => router.replace(`/week?date=${focusDate ?? todayKey}&view=columns`, { scroll: false })}>Colonne</button>
            <button type="button" aria-pressed={calendarView === "list"} data-track="week.list" onClick={() => router.replace(`/week?date=${focusDate ?? todayKey}&view=list`, { scroll: false })}>Elenco</button>
          </span>
        </div>

        {rescheduleWorkout.isError && <p className="ux-error" role="alert">Lo spostamento su Garmin non è riuscito. La seduta è rimasta nel giorno originale: riprova.</p>}
        {liveMode && (
          <div style={{ marginBottom: 16 }}>
            <Notice tone="neutral" title="Calendario Garmin" action={<Link className="btn" data-size="sm" href="/week/programs/new?source=import" data-track="week.import">Importa un programma</Link>}>
              Importa o crea un programma per vedere fasi e ritmi di ogni seduta.
            </Notice>
          </div>
        )}
        {weekSessions.length > 0 && (
          <p className="muted" style={{ margin: "0 0 12px", fontSize: "var(--text-sm)", color: carried ? "var(--accent-ink)" : undefined }} aria-live="polite">
            {rewriting
              ? `Sto riscrivendo i giorni fino a ${formatShortDate(rewriteUntil)}: potrai spostarli appena ho finito.`
              : carried
                ? "Rilascia sul giorno in cui spostarla."
                : "Apri una seduta per i dettagli. Per cambiarle giorno usa Sposta, oppure tienila premuta e trascinala."}
          </p>
        )}

        <div
          ref={setListEl}
          onClickCapture={(event) => {
            // A swipe that ends on a card would otherwise open it on the way out.
            if (!swipeHandled.current) return;
            swipeHandled.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {/* In live mode the days come from Garmin, so before that answer lands every
              day would read as "Riposo" -- a wrong statement, not a loading state. */}
          {liveMode && workoutsQuery.isPending ? (
            <SkeletonDayCards />
          ) : (
            <div
              key={offset}
              data-view={calendarView}
              className={["calendar-days", weekInClass, carried ? "week-list--dragging" : ""].filter(Boolean).join(" ")}
              style={weekInClass ? ({ ["--from-x" as string]: `${direction > 0 ? 24 : -24}px` } as React.CSSProperties) : undefined}
            >
              {days.map((day) => {
                const isToday = day.key === todayKey;
                const isPast = day.key < todayKey;
                const match = stravaMatches.data?.matches[day.key];
                const isDropTarget = !!carried && hoverDayKey === day.key && carried.session.date !== day.key;
                return (
                  <section
                    key={day.key}
                    className="calendar-day"
                    aria-label={day.date.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" })}
                    data-today={isToday || undefined}
                    data-past={(isPast && !carried) || undefined}
                    data-drop={isDropTarget || undefined}
                    ref={(el) => {
                      // Cleared on unmount: paging through weeks would otherwise pile up
                      // detached rows that the drop test still walks on every drag frame.
                      if (el) dayRowRefs.current.set(day.key, el as unknown as HTMLDivElement);
                      else dayRowRefs.current.delete(day.key);
                    }}
                  >
                    <div className="calendar-day-date" aria-hidden="true">
                      <span>{day.date.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "")}</span>
                      <b>{day.date.getDate()}</b>
                    </div>
                    <div className="calendar-day-items">
                      {day.cards.length === 0 && day.offPlan.length === 0 ? (
                        <RestCard animate={false} delayMs={0} withIllustration={false} />
                      ) : (
                        day.cards.map((card, j) => (
                          <div key={card.id}>
                            <DraggableWeekCard
                              card={card}
                              animate={false}
                              delayMs={0}
                              matchKm={j === 0 && match?.matched ? match.distance_km ?? null : null}
                              onDragStateChange={(dragging) => handleDragStateChange(card, dragging)}
                              onDragOver={handleDragOver}
                              onDrop={handleCardDrop}
                              onPrefetch={card.workout ? () => prefetchWorkoutSession(card.workout!) : undefined}
                              emphasis={j === 0 && day.key === nextDayKey ? (isToday ? "oggi" : "prossimo") : null}
                            />
                            <MoveSessionControl card={card} blocked={isRewritten(card.session.date) || rescheduleWorkout.isPending} onMove={(date) => {
                              if (isRewritten(date) || isRewritten(card.session.date)) return false;
                              if (card.planId) moveSession(card.planId, card.session.date, date);
                              else if (card.workout) rescheduleWorkout.mutate({ workout: card.workout, newDate: date });
                              return true;
                            }} />
                          </div>
                        ))
                      )}
                      {day.offPlan.map((activity) => (
                        <OffPlanCard key={activity.activity_id} activity={activity} animate={false} delayMs={0} />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </PullToRefresh>
  );
}

/** `useSearchParams` above makes this tree client-rendered up to the nearest Suspense
 * boundary, so it brings its own -- the same loading shape the page shows before it
 * knows whether there's a plan, rather than a blank tab. */
export function WeekView() {
  return (
    <Suspense fallback={<WeekFallback />}>
      <WeekPageContent />
    </Suspense>
  );
}

function WeekFallback() {
  const { start, end } = weekBounds(new Date());
  return (
    <div className="page">
      <WorkspaceHeading title="Piano" />
      <PlanNavigation />
      <WeekNav start={start} end={end} offset={0} onPrev={() => {}} onNext={() => {}} onToday={() => {}} />
      <SkeletonDayCards />
    </div>
  );
}

/** "Aggiungi": a single workout or a whole program, each with what it means. */
function AddMenu() {
  return (
    <details className="menu">
      <summary className="btn" data-variant="primary" data-track="week.add">
        <PlusIcon size={14} aria-hidden="true" />
        Aggiungi
      </summary>
      <div className="menu-panel">
        <Link data-track="week.week-new" href="/week/new?from=%2Fweek">
          Allenamento singolo
          <small>Una seduta in un giorno preciso</small>
        </Link>
        <Link data-track="week.new-program" href="/week/programs/new">
          Programma di allenamento
          <small>Più settimane verso un obiettivo</small>
        </Link>
      </div>
    </details>
  );
}

function WeekNav({ start, end, offset, onPrev, onNext, onToday }: { start: Date; end: Date; offset: number; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="week-nav">
      <button type="button" className="icon-btn" aria-label="Settimana precedente" onClick={onPrev} data-track="week.prev">
        <ChevronLeft size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <button type="button" className="icon-btn" aria-label="Settimana successiva" onClick={onNext} data-track="week.next">
        <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
      <p className="week-nav-range" aria-live="polite" aria-atomic="true" style={{ margin: 0 }}>
        {formatWeekRange(start, end)}
        <small>
          {offset === 0 ? "Questa settimana" : offset === 1 ? "La prossima settimana" : offset === -1 ? "La settimana scorsa" : `${start.getFullYear()}`}
        </small>
      </p>
      <button type="button" className="btn" data-size="sm" onClick={onToday} data-track="week.ontoday" {...dis(offset === 0, "gia_in_settimana")}>
        Oggi
      </button>
    </div>
  );
}

function MoveSessionControl({ card, blocked, onMove }: { card: DayCardData; blocked: boolean; onMove: (date: string) => boolean }) {
  const [date, setDate] = useState(card.session.date);
  const [error, setError] = useState(false);
  const detail = useRef<HTMLDetailsElement>(null);
  return <details className="week-move" ref={detail}>
    <summary data-track="week.move-open">Sposta<span className="sr-only"> {card.session.title}</span></summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (blocked || !date || date === card.session.date) return;
      if (!onMove(date)) { setError(true); return; }
      setError(false);
      if (detail.current) detail.current.open = false;
    }}>
      <label className="field">Nuovo giorno<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} data-track="week.move-date" /></label>
      <button type="submit" className="btn" data-track="week.move-confirm" {...dis(blocked || !date || date === card.session.date, blocked ? "in_caricamento" : "scegli_un_altro_giorno")}>Sposta seduta</button>
    </form>
    {error && <p role="alert" className="ux-error">Il piano di quel giorno è in aggiornamento. Riprova al termine.</p>}
  </details>;
}
