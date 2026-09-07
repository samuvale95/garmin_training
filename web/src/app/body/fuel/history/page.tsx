"use client";

import { PageHeader } from "@/components/PageHeader";
import { SlideUp, WordIn } from "@/components/motion/primitives";
import { useMotionEnabled, useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useFoodHistory, useFuelTargetsForDates, useWeekWorkouts } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { isoWeekNumber, toDateKey, weekBounds, workoutsToSessions } from "@/lib/sessionVisuals";

const DOW_LABELS = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const CHART_HEIGHT = 140;

function weekDateKeys(): string[] {
  const { start } = weekBounds(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toDateKey(d);
  });
}

export default function FuelHistoryPage() {
  const animate = useMountOnce("body-fuel-history");
  const { reduced } = useMotionEnabled();
  const access = useCalendarAccess();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  // Same fallback as /body/fuel: no imported plan means falling back to Garmin's own
  // calendar rather than reading every day of the week as a rest day.
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWeekWorkouts(new Date(), liveMode);
  const sessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);

  const dates = weekDateKeys();
  const historyQuery = useFoodHistory(7, dates[6]);
  // Seven target requests, so asking before the plan is back is seven wasted ones (see
  // `useFuelTargets`).
  const sessionsReady = access.ready && (!liveMode || !workoutsQuery.isPending);
  const targetQueries = useFuelTargetsForDates(dates, sessions, manualWeight?.weightKg, sessionsReady);

  const isLoading = historyQuery.isLoading || targetQueries.some((q) => q.isLoading);
  const historyByDate = new Map((historyQuery.data?.days ?? []).map((d) => [d.date, d]));
  const todayKey = toDateKey(new Date());

  const days = dates.map((date, i) => {
    const totals = historyByDate.get(date);
    const consumed = totals?.carb_g ?? 0;
    const target = targetQueries[i]?.data?.today.carb_g ?? null;
    const inTarget = target != null && consumed >= target[0];
    const pct = target && target[0] > 0 ? Math.min(1.15, consumed / target[0]) : 0;
    return { date, label: DOW_LABELS[i], entries: totals?.entries ?? 0, target, inTarget, pct, isToday: date === todayKey };
  });

  const withTarget = days.filter((d) => d.target);
  const fullDays = withTarget.filter((d) => d.inTarget).length;
  const avgPct = withTarget.length ? Math.round((withTarget.reduce((sum, d) => sum + d.pct, 0) / withTarget.length) * 100) : 0;
  const belowCount = withTarget.length - fullDays;
  const insightText =
    belowCount === 0
      ? "Tutta la settimana in target: bel ritmo."
      : `${belowCount} ${belowCount === 1 ? "giorno sotto target" : "giorni sotto target"} questa settimana. Capita nei giorni più leggeri, ed è normale.`;
  const totalEntries = (historyQuery.data?.days ?? []).reduce((sum, d) => sum + d.entries, 0);

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/body/fuel" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>carburante · settimana {isoWeekNumber(new Date())}</span>
      </div>

      <WordIn active={animate} as="h1" style={{ font: "600 30px/1.06 var(--font-outfit)", letterSpacing: "-.03em", margin: "16px 0 16px" }}>
        Sette giorni
      </WordIn>

      {isLoading ? (
        <p>Carico i dati…</p>
      ) : (
        <>
          <SlideUp active={animate} delayMs={100} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--inchiostro-50)" }}>carboidrati sul target del giorno</span>
              <div style={{ display: "flex", gap: 12 }}>
                <Legend color="var(--verde-tratto)" label="in target" />
                <Legend color="var(--neutro-barra)" label="sotto" />
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: CHART_HEIGHT, marginTop: 18 }}>
              {days.map((day, i) => (
                <div key={day.date} style={{ flex: 1, display: "flex", alignItems: "flex-end", height: "100%" }}>
                  <div
                    className={animate && !reduced ? "anim-bar-grow-y" : undefined}
                    style={{
                      width: "100%",
                      height: `${Math.max(4, day.pct * 100)}%`,
                      background: day.inTarget ? "var(--verde-tratto)" : "var(--neutro-barra)",
                      borderRadius: "8px 8px 0 0",
                      transformOrigin: "bottom",
                      animationDelay: animate ? `${i * 90}ms` : undefined,
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {days.map((day) => (
                <p
                  key={day.date}
                  className="font-mono"
                  style={{ flex: 1, textAlign: "center", fontSize: 11, color: day.isToday ? "var(--inchiostro)" : "var(--inchiostro-50)", fontWeight: day.isToday ? 700 : 400, margin: 0 }}
                >
                  {day.label}
                </p>
              ))}
            </div>

            <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", marginTop: 14 }}>
              {fullDays} {fullDays === 1 ? "giorno" : "giorni"} su sette {fullDays === 1 ? "pieno" : "pieni"} · media {avgPct}% del target
            </p>
          </SlideUp>

          <SlideUp active={animate} delayMs={220} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 12 }}>
            <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", margin: 0 }}>{insightText}</p>
          </SlideUp>

          <SlideUp active={animate} delayMs={280} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 12 }}>
            <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Voci registrate</p>
            <p style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: 0 }}>
              {totalEntries} {totalEntries === 1 ? "voce" : "voci"} in sette giorni
            </p>
          </SlideUp>
        </>
      )}

      <p style={{ textAlign: "center", fontSize: 11, color: "var(--inchiostro-35)", fontWeight: 500, marginTop: 26 }}>
        Orientamento sportivo generale, non un consiglio clinico.
      </p>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--inchiostro-50)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
