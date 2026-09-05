"use client";

import { Suspense, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion, useDragControls } from "framer-motion";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { BarGrow, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
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
import { classifySession, sessionDistanceKm, toDateKey, weekBounds, weekOffsetFromToday, type DisplaySession } from "@/lib/sessionVisuals";
import { sessionDetailLine } from "@/lib/format";
import type { ScheduledWorkout, TrainingSession } from "@/lib/types";

function formatWeekRange(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("it-IT", { month: "short" });
  const endMonth = end.toLocaleDateString("it-IT", { month: "short" });
  if (startMonth === endMonth) return `${start.getDate()} – ${end.getDate()} ${endMonth}`;
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}`;
}

function WeekPageContent() {
  const access = useCalendarAccess();
  const animate = useMountOnce("week");
  // `?date=` opens on the week containing that day instead of the current one -- how the
  // editor comes back after a save, since the day it saved on may not be in this week at
  // all (the day is editable: see WorkoutEditor's DayField). Read once, as the initial
  // offset: from there on the ‹ › buttons own which week is shown, so paging away from
  // the week we landed on doesn't fight with the URL that got us here.
  const focusDate = useSearchParams().get("date");
  const [offset, setOffset] = useState(() => (focusDate ? weekOffsetFromToday(focusDate) : 0));
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
  // by key, and a drag's release point is tested against every row's rect to find which
  // day it landed on -- cheaper than a real DnD library for a plain "move to this day"
  // gesture, and keeps the list a plain vertical stack (no reordering *within* a day).
  const dayRowRefs = useRef(new Map<string, HTMLDivElement | null>());
  const listContainerRef = useRef<HTMLDivElement>(null);

  function dayKeyAtPageY(pageY: number): string | null {
    for (const [key, el] of dayRowRefs.current) {
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (pageY >= rect.top + window.scrollY && pageY <= rect.bottom + window.scrollY) return key;
    }
    return null;
  }

  function handleCardDrop(card: DayCardData, pageY: number) {
    const targetKey = dayKeyAtPageY(pageY);
    if (!targetKey || targetKey === card.session.date) return;
    if (card.planIndex != null) {
      updateSession(card.planIndex, (s) => ({ ...s, date: targetKey }));
    } else if (card.workout) {
      rescheduleWorkout.mutate({ workout: card.workout, newDate: targetKey });
    }
  }

  // Same rule as Oggi: while we don't yet know whether there's a plan or a Garmin
  // connection, show this week's frame with empty day cards -- never a blank screen.
  if (!access.ready || (!access.plan && !access.garminConnected)) {
    return (
      <div>
        <WeekHeader start={start} end={end} animate={animate} onPrev={() => setOffset((o) => o - 1)} onNext={() => setOffset((o) => o + 1)} />
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
          onPrev={() => setOffset((o) => o - 1)}
          onNext={() => setOffset((o) => o + 1)}
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
          <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 8 }}>
            {summaryText}
          </p>
        )}

        {liveMode && (
          <Link href="/import" style={{ textDecoration: "none", color: "inherit" }}>
            <SlideUp active={animate} delayMs={140} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <p className="font-serif-italic" style={{ fontSize: 14, margin: 0, flex: 1 }}>
                Importa un piano per vedere step e passi di ogni seduta.
              </p>
              <span className="anim-chev" aria-hidden="true">→</span>
            </SlideUp>
          </Link>
        )}

        <div ref={listContainerRef} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* In live mode the days come from Garmin, so before that answer lands every
              day would read as "Riposo" -- a wrong statement, not a loading state. */}
          {liveMode && workoutsQuery.isPending ? (
            <SkeletonDayCards />
          ) : (
            days.map((day, i) => {
              const isToday = day.key === todayKey;
              const match = stravaMatches.data?.matches[day.key];
              return (
                <div
                  key={day.key}
                  ref={(el) => {
                    dayRowRefs.current.set(day.key, el);
                  }}
                  style={{ display: "flex", gap: 10 }}
                >
                  <div className="font-mono" style={{ width: 30, paddingTop: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? "var(--inchiostro)" : "var(--inchiostro-50)" }}>
                      {day.date.toLocaleDateString("it-IT", { weekday: "short" })}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: "var(--inchiostro)" }}>{day.date.getDate()}</span>
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                    {day.cards.length === 0 ? (
                      <RestCard animate={animate} delayMs={i * 80} />
                    ) : (
                      day.cards.map((card, j) => (
                        <DraggableWeekCard
                          key={card.id}
                          card={card}
                          animate={animate}
                          delayMs={i * 80 + j * 40}
                          matchKm={j === 0 && match?.matched ? match.distance_km ?? null : null}
                          containerRef={listContainerRef}
                          onDrop={handleCardDrop}
                          onPrefetch={card.workout ? () => prefetchWorkoutSession(card.workout!) : undefined}
                        />
                      ))
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

interface DayCardData {
  id: string;
  session: DisplaySession;
  planIndex?: number;
  workout?: ScheduledWorkout;
}

/** A day with nothing scheduled -- not draggable (there's nothing to move), and never
 * itself a drag target beyond being any other day row: dropping onto it just leaves the
 * dragged card here since `dayRowRefs` tracks the whole row, card or no card. */
function RestCard({ animate, delayMs }: { animate: boolean; delayMs: number }) {
  const visual = classifySession(null);
  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: visual.background,
        color: visual.foreground,
        borderRadius: "var(--radius-card)",
        padding: 14,
        minHeight: 78,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Riposo</p>
      <p className="font-serif-italic" style={{ fontSize: 13, margin: "4px 0 0", opacity: 0.85 }}>
        e va bene così
      </p>
      {visual.illustration && <Illustration name={visual.illustration} width={64} height={70} breathe={false} active={animate} delayMs={200 + delayMs} />}
    </SlideUp>
  );
}

interface DraggableWeekCardProps {
  card: DayCardData;
  animate: boolean;
  delayMs: number;
  matchKm: number | null;
  containerRef: { current: HTMLDivElement | null };
  onDrop: (card: DayCardData, pageY: number) => void;
  onPrefetch?: () => void;
}

/** One session/workout card in Settimana, draggable onto another day by its handle
 * (top-right ⠿) -- the rest of the card stays a plain tap target for navigation, so a
 * tap-to-open and a press-and-drag-to-move never fight over the same gesture (same
 * split `WorkoutEditor`'s step list uses between a drag handle and its row content).
 * `dragSnapToOrigin` matters here: on a same-day or off-list drop nothing about this
 * card's identity changes, so nothing remounts it to reset its dragged position -- the
 * snap-back has to be explicit. On a real move to another day, the card's `key` lives
 * under a different day row after the state update and this instance unmounts anyway,
 * so the snap-back animation is invisible. */
function DraggableWeekCard({ card, animate, delayMs, matchKm, containerRef, onDrop, onPrefetch }: DraggableWeekCardProps) {
  const dragControls = useDragControls();
  const [dragging, setDragging] = useState(false);
  const visual = classifySession(card.session);
  const height = 78 + Math.min(40, sessionDistanceKm(card.session) * 2);
  const detail = sessionDetailLine(card.session) || visual.label;

  const body = (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: visual.background,
        color: visual.foreground,
        borderRadius: "var(--radius-card)",
        padding: 14,
        minHeight: height,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, margin: 0, paddingRight: 26 }}>{card.session.title}</p>
      <p className="font-serif-italic" style={{ fontSize: 13, margin: "4px 0 0", opacity: 0.85 }}>
        {detail}
      </p>
      {matchKm != null && (
        <p className="font-mono" style={{ fontSize: 11, margin: "4px 0 0", opacity: 0.75 }}>
          svolto {matchKm.toFixed(1)} km
        </p>
      )}
      {visual.illustration && <Illustration name={visual.illustration} width={64} height={70} breathe={false} active={animate} delayMs={200 + delayMs} />}
    </SlideUp>
  );

  const href =
    card.planIndex != null
      ? `/session/${card.planIndex}`
      : card.workout?.scheduled_workout_id != null
        ? `/workout/${card.workout.scheduled_workout_id}?date=${card.session.date}`
        : null;

  return (
    <motion.div
      drag="y"
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={containerRef}
      dragElastic={0.12}
      dragMomentum={false}
      dragSnapToOrigin
      onDragStart={() => setDragging(true)}
      onDragEnd={(_event, info) => {
        setDragging(false);
        onDrop(card, info.point.y);
      }}
      whileDrag={{ scale: 1.03, boxShadow: "0 10px 28px rgba(28,26,22,.28)" }}
      style={{ position: "relative", zIndex: dragging ? 30 : "auto" }}
    >
      {href ? (
        <Link href={href} style={{ textDecoration: "none", color: "inherit" }} onPointerDown={onPrefetch}>
          {body}
        </Link>
      ) : (
        body
      )}
      <div
        role="button"
        aria-label="Trascina per spostare su un altro giorno"
        onPointerDown={(e) => {
          e.stopPropagation();
          dragControls.start(e);
        }}
        className="tap-target"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          width: 28,
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          touchAction: "none",
          cursor: "grab",
          opacity: 0.55,
          fontSize: 15,
          color: visual.foreground,
        }}
      >
        ⠿
      </div>
    </motion.div>
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
      <WeekHeader start={start} end={end} animate={false} onPrev={() => {}} onNext={() => {}} />
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
  onPrev: () => void;
  onNext: () => void;
}

/** Brand mark, week paging, refresh, "add workout", and the week range -- rendered the
 * same whether or not the week's data has arrived. */
function WeekHeaderRow({ start, end, animate, onPrev, onNext }: WeekHeaderProps) {
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
          <Link href="/week/new" aria-label="Aggiungi allenamento" className="tap-target" style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--inchiostro)", color: "var(--crema)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", textDecoration: "none", fontSize: 16 }}>
            +
          </Link>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <WordIn active={animate} style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>
          {formatWeekRange(start, end)}
        </WordIn>
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
      className="tap-target"
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
