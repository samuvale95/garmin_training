"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { SlideUp } from "@/components/motion/primitives";
import { classifySession, sessionDistanceKm, sessionDurationMinutes, toDateKey, type DisplaySession } from "@/lib/sessionVisuals";

interface WeekStripProps {
  currentDateKey: string;
  sessions: DisplaySession[];
  active?: boolean;
}

export function WeekStrip({ currentDateKey, sessions, active = true }: WeekStripProps) {
  // Generate Monday to Sunday for the current week of currentDateKey
  const current = new Date(currentDateKey + "T12:00:00Z");
  const dayOfWeek = (current.getDay() + 6) % 7; // Monday = 0
  const monday = new Date(current);
  monday.setDate(monday.getDate() - dayOfWeek);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    const daySessions = sessions.filter((s) => s.date === key);
    const primarySession = daySessions[0] ?? null;
    const isToday = key === currentDateKey;
    const km = daySessions.reduce((sum, s) => sum + sessionDistanceKm(s), 0);
    const duration = daySessions.reduce((sum, s) => sum + sessionDurationMinutes(s), 0);
    const isRest = daySessions.length === 0;

    return {
      date: d,
      key,
      weekday: d.toLocaleDateString("it-IT", { weekday: "narrow" }).toUpperCase(),
      dayNum: d.getDate(),
      daySessions,
      primarySession,
      isToday,
      km,
      duration,
      isRest,
    };
  });

  return (
    <SlideUp active={active} delayMs={160} style={{ marginTop: 14 }}>
      <div
        style={{
          background: "var(--crema-card)",
          border: "var(--border-airbnb)",
          boxShadow: "var(--shadow-airbnb-subtle)",
          borderRadius: "var(--radius-card)",
          padding: "12px 10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, padding: "0 4px" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro-50)", }}>
            Questa Settimana
          </span>
          <Link data-track="week-strip.week"
            href="/week"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "var(--corallo)",
              textDecoration: "none",
            }}
          >
            Vedi tutto →
          </Link>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
          {days.map((item) => {
            const visual = classifySession(item.primarySession);
            return (
              <Link data-track="week-strip.week-date-item-key"
                key={item.key}
                href={`/week?date=${item.key}`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <motion.div
                  whileTap={{ scale: 0.92 }}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    padding: "7px 2px 6px",
                    borderRadius: 12,
                    background: item.isToday ? "var(--inchiostro)" : "transparent",
                    color: item.isToday ? "var(--crema)" : "var(--inchiostro)",
                    border: item.isToday ? "none" : "1px solid transparent",
                    position: "relative",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, opacity: item.isToday ? 0.75 : 0.45 }}>
                    {item.weekday}
                  </span>
                  <span className="font-mono" style={{ fontSize: 14, fontWeight: 700, margin: "2px 0 3px" }}>
                    {item.dayNum}
                  </span>

                  {/* Indicator of session(s) */}
                  <div style={{ height: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 2 }}>
                    {item.isRest ? (
                      <span
                        style={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          background: item.isToday ? "rgba(255,255,255,0.3)" : "var(--sabbia-chip)",
                        }}
                      />
                    ) : item.daySessions.length > 1 ? (
                      item.daySessions.slice(0, 2).map((s, idx) => {
                        const sVisual = classifySession(s);
                        return (
                          <span
                            key={idx}
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: "50%",
                              background: item.isToday ? "var(--corallo)" : sVisual.background,
                            }}
                          />
                        );
                      })
                    ) : (
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: item.isToday ? "var(--corallo)" : visual.background,
                          boxShadow: item.isToday ? "0 0 6px var(--corallo)" : "none",
                        }}
                      />
                    )}
                  </div>

                  {/* Km text, duration or dash */}
                  <span
                    className="font-mono"
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      marginTop: 3,
                      color: item.isToday
                        ? "rgba(255,255,255,0.8)"
                        : item.isRest
                          ? "var(--inchiostro-30)"
                          : "var(--inchiostro-70)",
                    }}
                  >
                    {item.km > 0 ? `${item.km.toFixed(0)}k` : item.duration > 0 ? `${Math.round(item.duration)}'` : "—"}
                  </span>
                </motion.div>
              </Link>
            );
          })}
        </div>
      </div>
    </SlideUp>
  );
}
