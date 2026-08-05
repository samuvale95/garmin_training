"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { BarGrow, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useActivities, useStravaActivityMatches, useStravaStatus, useWorkouts } from "@/lib/queries";
import { classifySession, sessionDistanceKm, toDateKey, weekBounds, type DisplaySession } from "@/lib/sessionVisuals";
import { sessionDetailLine } from "@/lib/format";
import type { ScheduledWorkout, TrainingSession } from "@/lib/types";

function formatWeekRange(start: Date, end: Date): string {
  const startMonth = start.toLocaleDateString("it-IT", { month: "short" });
  const endMonth = end.toLocaleDateString("it-IT", { month: "short" });
  if (startMonth === endMonth) return `${start.getDate()} – ${end.getDate()} ${endMonth}`;
  return `${start.getDate()} ${startMonth} – ${end.getDate()} ${endMonth}`;
}

export default function WeekPage() {
  const access = useCalendarAccess();
  const animate = useMountOnce("week");
  const [offset, setOffset] = useState(0);
  const liveMode = !access.plan && access.garminConnected;
  const todayKey = toDateKey(new Date());

  const reference = new Date();
  reference.setDate(reference.getDate() + offset * 7);
  const { start, end } = weekBounds(reference);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const workoutsQuery = useWorkouts(startKey, endKey, liveMode);
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

  if (!access.ready || (!access.plan && !access.garminConnected)) return null;

  const sessions: DisplaySession[] = access.plan ? access.plan.sessions : workoutsQuery.data?.workouts ?? [];

  const days = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    const index = access.plan ? access.plan.sessions.findIndex((s) => s.date === key) : -1;
    const session = index >= 0 ? sessions[index] : sessions.find((s) => s.date === key) ?? null;
    return { date, key, session, index };
  });

  const weekSessions = days.map((d) => d.session).filter((s): s is NonNullable<typeof s> => !!s);
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
      <div style={{ padding: "22px 20px 0", position: "sticky", top: 0, zIndex: 1, background: "var(--crema)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <BrandMark height={22} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <NavButton label="Settimana precedente" onClick={() => setOffset((o) => o - 1)}>
              ‹
            </NavButton>
            <NavButton label="Settimana successiva" onClick={() => setOffset((o) => o + 1)}>
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

        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {days.map((day, i) => {
            const visual = classifySession(day.session);
            const height = day.session ? 78 + Math.min(40, sessionDistanceKm(day.session) * 2) : 78;
            const detail = day.session ? sessionDetailLine(day.session) || visual.label : "e va bene così";
            const isToday = day.key === todayKey;
            const match = stravaMatches.data?.matches[day.key];
            const card = (
              <SlideUp
                active={animate}
                delayMs={i * 80}
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
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{day.session ? day.session.title : "Riposo"}</p>
                <p className="font-serif-italic" style={{ fontSize: 13, margin: "4px 0 0", opacity: 0.85 }}>
                  {detail}
                </p>
                {match?.matched && match.distance_km != null && (
                  <p className="font-mono" style={{ fontSize: 11, margin: "4px 0 0", opacity: 0.75 }}>
                    svolto {match.distance_km.toFixed(1)} km
                  </p>
                )}
                {visual.illustration && (
                  <Illustration name={visual.illustration} width={64} height={70} breathe={false} active={animate} delayMs={200 + i * 80} />
                )}
              </SlideUp>
            );
            return (
              <div key={day.key} style={{ display: "flex", gap: 10 }}>
                <div className="font-mono" style={{ width: 30, paddingTop: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <span style={{ fontSize: 11, fontWeight: isToday ? 700 : 400, color: isToday ? "var(--inchiostro)" : "var(--inchiostro-50)" }}>
                    {day.date.toLocaleDateString("it-IT", { weekday: "short" })}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--inchiostro)" }}>{day.date.getDate()}</span>
                </div>
                <div style={{ flex: 1 }}>
                  {(() => {
                    if (day.session && day.index >= 0) {
                      return <Link href={`/session/${day.index}`} style={{ textDecoration: "none", color: "inherit" }}>{card}</Link>;
                    }
                    const workout = liveMode ? (day.session as ScheduledWorkout | null) : null;
                    if (workout?.scheduled_workout_id != null) {
                      return (
                        <Link href={`/workout/${workout.scheduled_workout_id}?date=${day.key}`} style={{ textDecoration: "none", color: "inherit" }}>
                          {card}
                        </Link>
                      );
                    }
                    return card;
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      </div>
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
