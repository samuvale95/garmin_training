"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { BarGrow, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useWorkouts } from "@/lib/queries";
import { classifySession, sessionDistanceKm, toDateKey, weekBounds, type DisplaySession } from "@/lib/sessionVisuals";
import { sessionDetailLine } from "@/lib/format";

export default function WeekPage() {
  const access = useCalendarAccess();
  const animate = useMountOnce("week");
  const [offset, setOffset] = useState(0);
  const liveMode = !access.plan && access.garminConnected;

  const reference = new Date();
  reference.setDate(reference.getDate() + offset * 7);
  const { start, end } = weekBounds(reference);
  const workoutsQuery = useWorkouts(toDateKey(start), toDateKey(end), liveMode);

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
  const completedFraction = 0.5; // real "done vs planned" needs Garmin activity data -- see body-insights follow-up

  return (
    <div>
      <div style={{ padding: "22px 20px 0", position: "sticky", top: 0, zIndex: 1, background: "var(--crema)" }}>
        <BrandMark height={22} />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 14 }}>
          <button className="tap-target" onClick={() => setOffset((o) => o - 1)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>
            ‹
          </button>
          <WordIn active={animate} style={{ font: "600 16px/1 var(--font-outfit)" }}>
            {start.toLocaleDateString("it-IT", { day: "numeric", month: "short" })} – {end.toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
          </WordIn>
          <button className="tap-target" onClick={() => setOffset((o) => o + 1)} style={{ background: "none", border: "none", fontSize: 18, cursor: "pointer" }}>
            ›
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <BarGrow value={completedFraction} height={4} active={animate} />
        </div>
      </div>

      <div style={{ padding: "0 20px 12px" }}>
        <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 8 }}>
          {liveMode ? `${weekSessions.length} sedute (calendario Garmin)` : `${weekKm.toFixed(0)} km · ${weekSessions.length} sedute`}
        </p>

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
                {visual.illustration && (
                  <Illustration name={visual.illustration} width={64} height={70} breathe={false} active={animate} delayMs={200 + i * 80} />
                )}
              </SlideUp>
            );
            return (
              <div key={day.key} style={{ display: "flex", gap: 10 }}>
                <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", width: 30, paddingTop: 14 }}>
                  {day.date.toLocaleDateString("it-IT", { weekday: "short" })}
                </span>
                <div style={{ flex: 1 }}>
                  {day.session && day.index >= 0 ? <Link href={`/session/${day.index}`} style={{ textDecoration: "none", color: "inherit" }}>{card}</Link> : card}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
