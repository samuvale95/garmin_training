"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { BarGrow, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { classifySession, sessionDistanceKm, toDateKey, weekBounds } from "@/lib/sessionVisuals";

export default function WeekPage() {
  const plan = useRequirePlan();
  const animate = useMountOnce("week");
  const [offset, setOffset] = useState(0);

  if (!plan) return null;

  const reference = new Date();
  reference.setDate(reference.getDate() + offset * 7);
  const { start, end } = weekBounds(reference);

  const days = Array.from({ length: 7 }).map((_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const key = toDateKey(date);
    const index = plan.sessions.findIndex((s) => s.date === key);
    return { date, key, session: index >= 0 ? plan.sessions[index] : null, index };
  });

  const weekSessions = days.map((d) => d.session).filter((s): s is NonNullable<typeof s> => !!s);
  const weekKm = weekSessions.reduce((sum, s) => sum + sessionDistanceKm(s), 0);
  const completedFraction = 0.5; // real "done vs planned" needs Garmin activity data -- see body-insights follow-up

  return (
    <div style={{ padding: "22px 20px 12px" }}>
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
      <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 8 }}>
        {weekKm.toFixed(0)} km · {weekSessions.length} sedute
      </p>

      <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {days.map((day, i) => {
          const visual = classifySession(day.session);
          const height = day.session ? 78 + Math.min(40, sessionDistanceKm(day.session) * 2) : 78;
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
                {day.session ? visual.label : "e va bene così"}
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
                {day.session ? <Link href={`/session/${day.index}`} style={{ textDecoration: "none", color: "inherit" }}>{card}</Link> : card}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
