"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { PlanNavigation, WorkspaceHeading } from "@/components/Workspace";
import { dis } from "@/lib/disabled";
import { motion } from "framer-motion";
import { BarGrow, SlideUp } from "@/components/motion/primitives";
import { ChevronLeft, ChevronRight, PlusIcon, ArrowRight } from "@/components/Icons";
import { DraggableWeekCard, RestCard, type DayCardData } from "@/components/WeekCards";
import { OffPlanCard, offPlanActivities } from "@/components/OffPlanCard";
import { useMotionEnabled, useMountOnce } from "@/lib/motion";
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
import { sessionDistanceKm, toDateKey, weekBounds, weekOffsetFromToday } from "@/lib/sessionVisuals";
import type { TrainingSession } from "@/lib/types";
import { formatShortDate } from "@/lib/format";
import { useScreenReady } from "@/lib/useScreenReady";

function formatWeekRange(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("it-IT", { month: "short" });
  const endMonth = end.toLocaleDateString("it-IT", { month: "short" });
  if (startMonth === endMonth) return `${start.getDate()} – ${end.getDate()} ${endMonth}`;
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}`;
}

/** How far a horizontal swipe has to travel before the list claims the gesture from
 * the browser, how much straighter than tall it has to be to count as horizontal at
 * all, and how far it has to go in total to actually change week. */
const SWIPE_LOCK_PX = 18;
const SWIPE_STRAIGHTNESS = 1.4;
const SWIPE_MIN_PX = 52;

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
  const animate = useMountOnce("week");
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
  const swipe = useRef<{ x: number; y: number; at: number; locked: boolean } | null>(null);
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

  // Same rule as Oggi: while we don't yet know whether there's a plan or a Garmin
  // connection, show this week's frame with empty day cards -- never a blank screen.
  // Above the early return below: a hook after it would run on some renders and not
  // others (first render is always "not ready"), which React rejects outright.
  const refreshMutation = useRefreshServerData();
  // Ready also with neither plan nor Garmin: the guard is sending the user to /import.
  useScreenReady(access.ready && !(liveMode && workoutsQuery.isPending), "/week");

  if (!access.ready) {
    return (
      <div>
        <WeekHeader start={start} end={end} animate={animate} offset={offset} onPrev={() => pageWeek(-1)} onNext={() => pageWeek(1)} onToday={goToCurrentWeek} />
        <div style={{ padding: "16px 20px 12px" }}>
          <SkeletonDayCards />
        </div>
      </div>
    );
  }

  if (!access.plan && !access.garminConnected) return <div className="workspace-page">
    <WorkspaceHeading title="Piano" description="Organizza i tuoi prossimi allenamenti." /><PlanNavigation />
    <div className="ux-empty"><h2>Costruisci la tua settimana</h2><p>Importa un programma, genera le prossime sedute oppure collega Garmin per consultare il calendario.</p><div className="ux-actions"><Link className="ux-button ux-button-primary" href="/week/programs" data-track="week.empty-programs">Crea o importa un programma</Link><Link className="ux-button" href="/connect-garmin" data-track="week.empty-connect">Collega Garmin</Link></div></div>
  </div>;

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
  const doneKm = (activitiesQuery.data?.activities ?? []).reduce((sum, a) => sum + (a.distance_km ?? 0), 0);
  const progressFraction = weekKm > 0 ? Math.min(1, doneKm / weekKm) : 0;

  const summaryText = liveMode
    ? `${weekSessions.length} sedute (calendario Garmin)`
    : showProgress
      ? `${doneKm.toFixed(0)} / ${weekKm.toFixed(0)} km · ${weekSessions.length} sedute`
      : `${weekKm.toFixed(0)} km · ${weekSessions.length} sedute`;

  // The session the week is waiting on: today's, unless it is already done, else the
  // next one this week. Only on the current week -- elsewhere nothing is "next".
  const doneToday = (storedActivities.data?.activities ?? []).some((a) => a.day === todayKey && a.family !== "walk");
  const nextDayKey =
    offset === 0
      ? days.find((d) => d.cards.length > 0 && (doneToday ? d.key > todayKey : d.key >= todayKey))?.key ?? null
      : null;

  const firstRestIndex = days.findIndex((d) => d.cards.length === 0 && d.offPlan.length === 0);
  const weekInClass = reduced || direction === 0 ? undefined : "anim-week-in";

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div>
      {/* Not sticky: pinned, its opaque crema block (title + the light round buttons)
          scrolled over the day cards and swallowed whatever line was passing under it.
          Oggi's header scrolls away too -- the two tabs now behave the same. */}
      <div style={{ padding: "22px 20px 0" }}>
        <WeekHeaderRow
          start={start}
          end={end}
          animate={animate}
          offset={offset}
          onPrev={() => pageWeek(-1)}
          onNext={() => pageWeek(1)}
          onToday={goToCurrentWeek}
        />

        {showProgress && (
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <BarGrow value={progressFraction} height={4} active={animate} />
            </div>
            <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", flex: "none" }}>
              {summaryText}
            </span>
          </div>
        )}
      </div>

      <div style={{ padding: "0 20px 12px" }}>
        <div className="calendar-view-switch" role="group" aria-label="Vista calendario"><button className="ux-button" aria-pressed={calendarView === "columns"} data-track="week.columns" onClick={() => router.replace(`/week?date=${focusDate ?? todayKey}&view=columns`, { scroll: false })}>Settimana</button><button className="ux-button" aria-pressed={calendarView === "list"} data-track="week.list" onClick={() => router.replace(`/week?date=${focusDate ?? todayKey}&view=list`, { scroll: false })}>Elenco</button></div>
        {rescheduleWorkout.isError && <p className="ux-error" role="alert">Lo spostamento su Garmin non è riuscito. Riprova.</p>}
        {!showProgress && (
          <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>
            {summaryText}
          </p>
        )}

        {liveMode && (
          <Link data-track="week.import" href="/import" style={{ textDecoration: "none", color: "inherit" }}>
            <SlideUp active={animate} delayMs={140} className="press-soft" style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <p className="font-serif-italic" style={{ fontSize: 14, margin: 0, flex: 1 }}>
                Importa un piano per vedere step e passi di ogni seduta.
              </p>
              <ChevronRight size={16} style={{ color: "var(--inchiostro-50)" }} />
            </SlideUp>
          </Link>
        )}

        {/* Only on this week: generation always starts tomorrow, so offering it while
            paging through past or later weeks would promise a window it won't write. */}


        {offset <= 0 && (
          <Link data-track="week.summary-monday-startkey" href={`/summary?monday=${startKey}`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--inchiostro-70)", marginTop: 10 }}>
            <span>Resoconto della settimana</span>
            <ArrowRight size={13} />
          </Link>
        )}

        {weekSessions.length > 0 && (
          <p style={{ fontSize: 11.5, color: carried ? "var(--rosso-avviso)" : "var(--inchiostro-35)", margin: "10px 0 0", transition: "color 160ms var(--ease)" }}>
            {rewriting
              ? `Sto riscrivendo i giorni fino a ${formatShortDate(rewriteUntil)}: potrai spostarli appena ho finito.`
              : carried
                ? "Rilascia sul giorno in cui spostarla."
                : "Apri una seduta per i dettagli, oppure scegli Sposta per cambiare giorno."}
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
          style={{ marginTop: 14 }}
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
              style={{
                position: "relative",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                ...(weekInClass ? ({ ["--from-x" as string]: `${direction > 0 ? 24 : -24}px` } as React.CSSProperties) : null),
              }}
            >
              {/* The thread the seven days hang off. Each day's number sits on its own
                  crema disc, so the line passes behind them rather than through them. */}
              <span className="calendar-thread" aria-hidden="true" style={{ position: "absolute", left: 17.5, top: 22, bottom: 22, width: 1, background: "var(--sabbia-bordo)" }} />

              {days.map((day, i) => {
                const isToday = day.key === todayKey;
                const isPast = day.key < todayKey;
                const match = stravaMatches.data?.matches[day.key];
                const isDropTarget = !!carried && hoverDayKey === day.key && carried.session.date !== day.key;
                return (
                  <div
                    key={day.key}
                    className="calendar-day"
                    data-today={isToday || undefined}
                    ref={(el) => {
                      // Cleared on unmount rather than left behind: paging through
                      // weeks would otherwise pile up detached rows that the drop test
                      // still walks on every drag frame.
                      if (el) dayRowRefs.current.set(day.key, el);
                      else dayRowRefs.current.delete(day.key);
                    }}
                    style={{ display: "flex", gap: 10, position: "relative" }}
                  >
                    <div className="font-mono" style={{ width: 36, paddingTop: 12, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, flex: "none" }}>
                      <span style={{ fontSize: 10, letterSpacing: ".04em", textTransform: "uppercase", color: isToday ? "var(--inchiostro-70)" : "var(--inchiostro-35)" }}>
                        {day.date.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", "")}
                      </span>
                      <span
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 13,
                          fontWeight: 500,
                          background: isDropTarget ? "var(--corallo)" : isToday ? "var(--inchiostro)" : "var(--crema)",
                          color: isDropTarget ? "var(--corallo-testo)" : isToday ? "var(--crema)" : "var(--inchiostro)",
                          transition: "background 160ms var(--ease), color 160ms var(--ease)",
                        }}
                      >
                        {day.date.getDate()}
                      </span>
                    </div>
                    <div
                      className={isDropTarget ? "day-drop-target" : undefined}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                        // Days already behind stay readable but step back: what is left
                        // of the week is what can still be acted on.
                        opacity: isPast && !carried ? 0.62 : 1,
                        transition: "opacity 160ms var(--ease)",
                      }}
                    >
                      {day.cards.length === 0 && day.offPlan.length === 0 ? (
                        <RestCard animate={animate} delayMs={i * 70} withIllustration={i === firstRestIndex} />
                      ) : (
                        day.cards.map((card, j) => (
                          <div key={card.id}>
                          <DraggableWeekCard
                            card={card}
                            animate={animate}
                            delayMs={i * 70 + j * 40}
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
                      {day.offPlan.map((activity, j) => (
                        <OffPlanCard key={activity.activity_id} activity={activity} animate={animate} delayMs={i * 70 + (day.cards.length + j) * 40} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
    <div>
      <WeekHeader start={start} end={end} animate={false} offset={0} onPrev={() => {}} onNext={() => {}} onToday={() => {}} />
      <div style={{ padding: "16px 20px 12px" }}>
        <SkeletonDayCards />
      </div>
    </div>
  );
}

interface WeekHeaderProps {
  start: Date;
  end: Date;
  animate: boolean;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

/** Brand mark, week paging, "add workout", the week range -- rendered the same whether
 * or not the week's data has arrived. */
function WeekHeaderRow({ start, end, offset, onPrev, onNext, onToday }: WeekHeaderProps) {
  return (
    <>
      <WorkspaceHeading title="Piano">
        <details className="calendar-add"><summary className="ux-button" data-track="week.add"><PlusIcon size={14} />Aggiungi</summary><div className="calendar-add-menu"><Link data-track="week.week-new" href="/week/new" className="ux-button">Allenamento singolo<small>Una seduta in un giorno preciso</small></Link><Link data-track="week.new-program" href="/week/programs/new" className="ux-button">Programma di allenamento<small>Più settimane verso un obiettivo</small></Link></div></details>
      </WorkspaceHeading>
      <PlanNavigation />
      <div className="week-picker">
        <NavButton label="Settimana precedente" onClick={onPrev}>
          <ChevronLeft size={16} strokeWidth={2.4} />
        </NavButton>
        <div className="week-picker-label" aria-live="polite" aria-atomic="true">
          <span>{formatWeekRange(start, end)}</span>
          <span className="week-picker-caption">{start.getFullYear()}{start.getFullYear() !== end.getFullYear() ? ` – ${end.getFullYear()}` : ""}</span>
        </div>
        <NavButton label="Settimana successiva" onClick={onNext}>
          <ChevronRight size={16} strokeWidth={2.4} />
        </NavButton>
      </div>
      {offset !== 0 && (
        <motion.button data-track="week.ontoday"
          type="button"
          onClick={onToday}
          whileTap={{ scale: 0.95 }}
          whileHover={{ scale: 1.03 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className="tap-target week-reset"
        >
          Torna a questa settimana
        </motion.button>
      )}
    </>
  );
}

/** The same header inside its container, for the loading state. */
function WeekHeader(props: WeekHeaderProps) {
  return (
    <div style={{ padding: "22px 20px 0" }}>
      <WeekHeaderRow {...props} />
    </div>
  );
}

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button data-track="week.onclick"
      className="tap-target"
      aria-label={label}
      onClick={onClick}
      whileTap={{ scale: 0.84 }}
      whileHover={{ scale: 1.15 }}
      transition={{ type: "spring", stiffness: 500, damping: 22 }}
      style={{
        width: 44,
        height: 44,
        borderRadius: "50%",
        background: "var(--sabbia-chip)",
        color: "var(--inchiostro)",
        border: "none",
        fontSize: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flex: "none",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}
    >
      {children}
    </motion.button>
  );
}


function MoveSessionControl({ card, blocked, onMove }: { card: DayCardData; blocked: boolean; onMove: (date: string) => boolean }) {
  const [date, setDate] = useState(card.session.date);
  const [error, setError] = useState(false);
  const detail = useRef<HTMLDetailsElement>(null);
  return <details className="week-move" ref={detail}>
    <summary data-track="week.move-open">Sposta <span className="sr-only">{card.session.title}</span></summary>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (blocked || !date || date === card.session.date) return;
      if (!onMove(date)) { setError(true); return; }
      setError(false);
      if (detail.current) detail.current.open = false;
    }}>
      <label className="ux-field">Nuovo giorno<input type="date" required value={date} onChange={(event) => setDate(event.target.value)} data-track="week.move-date" /></label>
      <button type="submit" className="ux-button" data-track="week.move-confirm" {...dis(blocked || !date || date === card.session.date, blocked ? "in_caricamento" : "scegli_un_altro_giorno")}>Sposta seduta</button>
    </form>
    {error && <p role="alert" className="ux-error">Il piano di quel giorno è in aggiornamento. Riprova al termine.</p>}
  </details>;
}
