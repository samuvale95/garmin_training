"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { BarGrow, SlideUp, WordIn } from "@/components/motion/primitives";
import { DraggableWeekCard, RestCard, type DayCardData } from "@/components/WeekCards";
import { useMotionEnabled, useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import {
  useActivities,
  usePrefetchWorkoutSession,
  useRescheduleWorkout,
  useStravaActivityMatches,
  useStravaStatus,
  useUpdateSession,
  useWeekWorkouts,
} from "@/lib/queries";
import { SkeletonDayCards } from "@/components/skeletons";
import { sessionDistanceKm, toDateKey, weekBounds, weekOffsetFromToday } from "@/lib/sessionVisuals";
import type { TrainingSession } from "@/lib/types";

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

function WeekPageContent() {
  const access = useCalendarAccess();
  const animate = useMountOnce("week");
  const { reduced } = useMotionEnabled();
  // `?date=` opens on the week containing that day instead of the current one -- how the
  // editor comes back after a save, since the day it saved on may not be in this week at
  // all (the day is editable: see WorkoutEditor's DayField). Read once, as the initial
  // offset: from there on the ‹ › buttons own which week is shown, so paging away from
  // the week we landed on doesn't fight with the URL that got us here.
  const focusDate = useSearchParams().get("date");
  const [offset, setOffset] = useState(() => (focusDate ? weekOffsetFromToday(focusDate) : 0));
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
  const stravaEnabled = !!stravaStatus.data?.connected && planSessions.length > 0;
  const stravaMatches = useStravaActivityMatches(planSessions, stravaEnabled);
  const prefetchWorkoutSession = usePrefetchWorkoutSession();
  const updateSession = useUpdateSession();
  const rescheduleWorkout = useRescheduleWorkout();

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
    haptic([10, 40, 14]);
    if (card.planIndex != null) {
      updateSession(card.planIndex, (s) => ({ ...s, date: targetKey }));
    } else if (card.workout) {
      rescheduleWorkout.mutate({ workout: card.workout, newDate: targetKey });
    }
  }

  const pageWeek = useCallback((delta: number) => {
    setDirection(delta);
    setOffset((o) => o + delta);
  }, []);

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
  // scrolls sideways, so nothing is lost by doing so.
  useEffect(() => {
    const el = listEl;
    if (!el) return;

    const onTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch || event.touches.length > 1) {
        swipe.current = null;
        return;
      }
      swipe.current = { x: touch.clientX, y: touch.clientY, at: Date.now(), locked: false };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (carriedRef.current) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      const from = swipe.current;
      const touch = event.touches[0];
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      if (!from.locked && Math.abs(dx) > SWIPE_LOCK_PX && Math.abs(dx) > Math.abs(dy) * SWIPE_STRAIGHTNESS) {
        from.locked = true;
      }
      if (from.locked && event.cancelable) event.preventDefault();
    };

    const onTouchEnd = (event: TouchEvent) => {
      const from = swipe.current;
      swipe.current = null;
      if (!from || !from.locked || carriedRef.current) return;
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - from.x;
      if (Math.abs(dx) < SWIPE_MIN_PX || Date.now() - from.at > 800) return;
      // Nothing should open because a swipe happened to start on a card.
      swipeHandled.current = true;
      window.setTimeout(() => {
        swipeHandled.current = false;
      }, 400);
      pageWeek(dx < 0 ? 1 : -1);
    };

    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [listEl, pageWeek]);

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
    setOffset(0);
  }

  // Same rule as Oggi: while we don't yet know whether there's a plan or a Garmin
  // connection, show this week's frame with empty day cards -- never a blank screen.
  if (!access.ready || (!access.plan && !access.garminConnected)) {
    return (
      <div>
        <WeekHeader start={start} end={end} animate={animate} offset={offset} onPrev={() => pageWeek(-1)} onNext={() => pageWeek(1)} onToday={goToCurrentWeek} />
        <div style={{ padding: "16px 20px 12px" }}>
          <SkeletonDayCards />
        </div>
      </div>
    );
  }

  const days = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    const cards: DayCardData[] = access.plan
      ? access.plan.sessions
          .map((session, index) => ({ session, index }))
          .filter((x) => x.session.date === key)
          .map(({ session, index }) => ({ id: `plan:${index}`, session, planIndex: index }))
      : liveMode
        ? (workoutsQuery.data?.workouts ?? [])
            .filter((w) => w.date === key)
            .map((w) => ({ id: `garmin:${w.scheduled_workout_id}`, session: w, workout: w }))
        : [];
    return { date, key, cards };
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

  const firstRestIndex = days.findIndex((d) => d.cards.length === 0);
  const weekInClass = reduced || direction === 0 ? undefined : "anim-week-in";

  return (
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
        {!showProgress && (
          <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>
            {summaryText}
          </p>
        )}

        {liveMode && (
          <Link href="/import" style={{ textDecoration: "none", color: "inherit" }}>
            <SlideUp active={animate} delayMs={140} className="press-soft" style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <p className="font-serif-italic" style={{ fontSize: 14, margin: 0, flex: 1 }}>
                Importa un piano per vedere step e passi di ogni seduta.
              </p>
              <span className="anim-chev" aria-hidden="true">→</span>
            </SlideUp>
          </Link>
        )}

        {weekSessions.length > 0 && (
          <p style={{ fontSize: 11.5, color: carried ? "var(--rosso-avviso)" : "var(--inchiostro-35)", margin: "10px 0 0", transition: "color 160ms var(--ease)" }}>
            {carried ? "Rilascia sul giorno in cui spostarla." : "Tieni premuta una seduta per spostarla di giorno."}
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
              className={[weekInClass, carried ? "week-list--dragging" : ""].filter(Boolean).join(" ")}
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
              <span aria-hidden="true" style={{ position: "absolute", left: 17.5, top: 22, bottom: 22, width: 1, background: "var(--sabbia-bordo)" }} />

              {days.map((day, i) => {
                const isToday = day.key === todayKey;
                const match = stravaMatches.data?.matches[day.key];
                const isDropTarget = !!carried && hoverDayKey === day.key && carried.session.date !== day.key;
                return (
                  <div
                    key={day.key}
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
                    <div className={isDropTarget ? "day-drop-target" : undefined} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
                      {day.cards.length === 0 ? (
                        <RestCard animate={animate} delayMs={i * 70} withIllustration={i === firstRestIndex} />
                      ) : (
                        day.cards.map((card, j) => (
                          <DraggableWeekCard
                            key={card.id}
                            card={card}
                            animate={animate}
                            delayMs={i * 70 + j * 40}
                            matchKm={j === 0 && match?.matched ? match.distance_km ?? null : null}
                            onDragStateChange={(dragging) => handleDragStateChange(card, dragging)}
                            onDragOver={handleDragOver}
                            onDrop={handleCardDrop}
                            onPrefetch={card.workout ? () => prefetchWorkoutSession(card.workout!) : undefined}
                          />
                        ))
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** `useSearchParams` above makes this tree client-rendered up to the nearest Suspense
 * boundary, so it brings its own -- the same loading shape the page shows before it
 * knows whether there's a plan, rather than a blank tab. */
export default function WeekPage() {
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
function WeekHeaderRow({ start, end, animate, offset, onPrev, onNext, onToday }: WeekHeaderProps) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark height={22} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <NavButton label="Settimana precedente" onClick={onPrev}>
            ‹
          </NavButton>
          <NavButton label="Settimana successiva" onClick={onNext}>
            ›
          </NavButton>
          <Link href="/week/new" aria-label="Aggiungi allenamento" className="tap-target press-soft" style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--inchiostro)", color: "var(--crema)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", textDecoration: "none", fontSize: 16 }}>
            +
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 14 }}>
        <WordIn active={animate} style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>
          {formatWeekRange(start, end)}
        </WordIn>
        {offset !== 0 && (
          <button
            type="button"
            onClick={onToday}
            className="press-soft"
            style={{
              flex: "none",
              background: "var(--sabbia-chip)",
              color: "var(--inchiostro-70)",
              border: "none",
              borderRadius: "var(--radius-pill)",
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            questa settimana
          </button>
        )}
      </div>
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

function NavButton({ label, onClick, children }: { label: string; onClick: () => void; children: string }) {
  return (
    <button
      className="tap-target press-soft"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: "var(--sabbia-chip)",
        color: "var(--inchiostro)",
        border: "none",
        fontSize: 15,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flex: "none",
      }}
    >
      {children}
    </button>
  );
}
