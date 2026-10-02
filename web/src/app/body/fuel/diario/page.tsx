"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp } from "@/components/motion/primitives";
import { MealRow } from "@/components/FuelBlocks";
import { FuelCorrectionSheet } from "@/components/FuelCorrectionSheet";
import { useMountOnce } from "@/lib/motion";
import { formatFullDate } from "@/lib/format";
import { useCalendarAccess } from "@/lib/guards";
import { useFoodEntries, useFuelTargetsForDates, useWeekWorkouts } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { classifySession, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import type { FoodEntry, FuelTargets, TrainingSession } from "@/lib/types";

/** How far back the diary reads. Two weeks is the window someone actually revisits. */
const DIARY_DAYS = 14;

export default function FuelDiaryPage() {
  const animate = useMountOnce("body-fuel-diario");
  const access = useCalendarAccess();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWeekWorkouts(new Date(), liveMode);
  const sessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);

  const entriesQuery = useFoodEntries(DIARY_DAYS);
  const [correcting, setCorrecting] = useState<FoodEntry | null>(null);

  const entries = entriesQuery.data?.entries ?? [];
  const todayKey = toDateKey(new Date());

  // Group entries reliably by date (newest date first)
  const days: { date: string; entries: FoodEntry[] }[] = useMemo(() => {
    const map = new Map<string, FoodEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.date);
      if (list) list.push(entry);
      else map.set(entry.date, [entry]);
    }
    return Array.from(map.entries())
      .map(([date, items]) => ({ date, entries: items }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [entries]);

  const uniqueDates = useMemo(() => days.map((d) => d.date), [days]);
  const sessionsReady = access.ready && (!liveMode || !workoutsQuery.isPending);
  const targetQueries = useFuelTargetsForDates(uniqueDates, sessions, manualWeight?.weightKg, sessionsReady && uniqueDates.length > 0);

  const targetsByDate = useMemo(() => {
    const map = new Map<string, FuelTargets>();
    uniqueDates.forEach((date, i) => {
      const data = targetQueries[i]?.data;
      if (data) map.set(date, data);
    });
    return map;
  }, [uniqueDates, targetQueries]);

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/body/fuel" />
        <h1 style={{ font: "600 20px/1 var(--font-sans)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>Diario pasti</h1>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-70)", background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "6px 12px" }}>
          ultimi {DIARY_DAYS} giorni
        </span>
      </div>

      {entriesQuery.isLoading ? (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={84} radius={18} />
          <Skeleton height={84} radius={18} />
          <Skeleton height={84} radius={18} />
        </div>
      ) : days.length === 0 ? (
        <EmptyDiary animate={animate} />
      ) : (
        days.map((day, i) => {
          const daySessions = sessions.filter((s) => s.date === day.date);
          const target = targetsByDate.get(day.date);
          return (
            <DaySection
              key={day.date}
              date={day.date}
              entries={day.entries}
              isToday={day.date === todayKey}
              sessions={daySessions}
              target={target}
              animate={animate}
              delayMs={80 + i * 50}
              onSelect={setCorrecting}
            />
          );
        })
      )}

      {correcting && <FuelCorrectionSheet entry={correcting} onClose={() => setCorrecting(null)} />}
    </div>
  );
}

function DaySection({
  date,
  entries,
  isToday,
  sessions,
  target,
  animate,
  delayMs,
  onSelect,
}: {
  date: string;
  entries: FoodEntry[];
  isToday: boolean;
  sessions: TrainingSession[];
  target?: FuelTargets;
  animate: boolean;
  delayMs: number;
  onSelect: (entry: FoodEntry) => void;
}) {
  const totals = entries.reduce(
    (sum, entry) => ({
      carb: sum.carb + (entry.carb_g ?? 0),
      protein: sum.protein + (entry.protein_g ?? 0),
      kcal: sum.kcal + (entry.kcal ?? 0),
    }),
    { carb: 0, protein: 0, kcal: 0 }
  );

  const mainSession = sessions[0] ?? null;
  const visual = classifySession(mainSession);
  const carbTarget = target?.today.carb_g ?? null;
  const inTarget = carbTarget != null && totals.carb >= carbTarget[0];

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 24 }}>
      {/* Header giorno con contesto allenamento e target */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "var(--inchiostro)" }}>
              {isToday ? "Oggi" : formatFullDate(date)}
            </span>
            {mainSession && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 8px",
                  borderRadius: "var(--radius-pill)",
                  background: visual.background,
                  color: visual.foreground,
                }}
              >
                {visual.label}
              </span>
            )}
          </div>
          {carbTarget && (
            <p style={{ margin: "2px 0 0", fontSize: 11, color: "var(--inchiostro-50)" }}>
              Target: {carbTarget[0]}–{carbTarget[1]} g C {inTarget ? "✓ raggiunto" : ""}
            </p>
          )}
        </div>

        <div style={{ textAlign: "right" }}>
          <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: inTarget ? "var(--verde-tratto-scuro)" : "var(--inchiostro)" }}>
            {Math.round(totals.carb)} g C
          </span>
          <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", display: "block" }}>
            {Math.round(totals.protein)} g P{totals.kcal > 0 && ` · ${Math.round(totals.kcal)} kcal`}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry) => (
          <MealRow key={entry.id} entry={entry} onSelect={onSelect} />
        ))}
      </div>
    </SlideUp>
  );
}

function EmptyDiary({ animate }: { animate: boolean }) {
  return (
    <SlideUp active={animate} delayMs={100} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 18 }}>
      <p style={{ font: "600 17px/1.2 var(--font-sans)", margin: 0 }}>Ancora nessun pasto registrato</p>
      <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", margin: "10px 0 0", lineHeight: 1.35 }}>
        Fotografa un piatto o scrivi cosa hai mangiato: da lì in poi lo ritrovi qui, e
        puoi correggerlo quando vuoi.
      </p>
      <Link
        href="/body/fuel"
        className="press-soft"
        style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-pill)", padding: "12px 18px", marginTop: 16, textDecoration: "none", fontSize: 14, fontWeight: 600 }}
      >
        Aggiungi un pasto
      </Link>
    </SlideUp>
  );
}
