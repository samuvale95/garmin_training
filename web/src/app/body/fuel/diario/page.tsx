"use client";

import { useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp } from "@/components/motion/primitives";
import { MealRow } from "@/components/FuelBlocks";
import { FuelCorrectionSheet } from "@/components/FuelCorrectionSheet";
import { useMountOnce } from "@/lib/motion";
import { formatFullDate } from "@/lib/format";
import { useFoodEntries } from "@/lib/queries";
import { toDateKey } from "@/lib/sessionVisuals";
import type { FoodEntry } from "@/lib/types";

/** How far back the diary reads. Two weeks is the window someone actually revisits --
 * "did I log yesterday's dinner?", "what did I eat before the last long run?" -- and
 * it is one request either way (`/nutrition/entries`). */
const DIARY_DAYS = 14;

/** Every meal logged, day by day, with any of them one tap away from being corrected.
 *
 * The fuel screen only ever shows *today*, which left no way back to a meal estimated
 * wrongly yesterday: the numbers were stored, counted in the history strip, and
 * unreachable. This is that way back.
 */
export default function FuelDiaryPage() {
  const animate = useMountOnce("body-fuel-diario");
  const entriesQuery = useFoodEntries(DIARY_DAYS);
  const [correcting, setCorrecting] = useState<FoodEntry | null>(null);

  const entries = entriesQuery.data?.entries ?? [];
  const todayKey = toDateKey(new Date());

  // The endpoint already returns newest first; this only groups, so the order it
  // decided is the order shown.
  const days: { date: string; entries: FoodEntry[] }[] = [];
  for (const entry of entries) {
    const last = days[days.length - 1];
    if (last && last.date === entry.date) last.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/body/fuel" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>Diario</h1>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-70)", background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "6px 12px" }}>
          {DIARY_DAYS} giorni
        </span>
      </div>

      {entriesQuery.isLoading ? (
        <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={74} radius={18} />
          <Skeleton height={74} radius={18} />
          <Skeleton height={74} radius={18} />
        </div>
      ) : days.length === 0 ? (
        <EmptyDiary animate={animate} />
      ) : (
        days.map((day, i) => (
          <DaySection
            key={day.date}
            date={day.date}
            entries={day.entries}
            isToday={day.date === todayKey}
            animate={animate}
            delayMs={80 + i * 60}
            onSelect={setCorrecting}
          />
        ))
      )}

      {correcting && <FuelCorrectionSheet entry={correcting} onClose={() => setCorrecting(null)} />}
    </div>
  );
}

function DaySection({
  date,
  entries,
  isToday,
  animate,
  delayMs,
  onSelect,
}: {
  date: string;
  entries: FoodEntry[];
  isToday: boolean;
  animate: boolean;
  delayMs: number;
  onSelect: (entry: FoodEntry) => void;
}) {
  // Summed here rather than asked for: the entries are already on the client, and a
  // second endpoint for the same arithmetic would be one more thing to keep in step
  // with a correction made two rows below.
  const totals = entries.reduce(
    (sum, entry) => ({
      carb: sum.carb + (entry.carb_g ?? 0),
      protein: sum.protein + (entry.protein_g ?? 0),
      kcal: sum.kcal + (entry.kcal ?? 0),
    }),
    { carb: 0, protein: 0, kcal: 0 }
  );

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 22 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{isToday ? "Oggi" : formatFullDate(date)}</span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          {Math.round(totals.carb)} g C · {Math.round(totals.protein)} g P
          {totals.kcal > 0 && ` · ${Math.round(totals.kcal)} kcal`}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
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
      <p style={{ font: "600 17px/1.2 var(--font-outfit)", margin: 0 }}>Ancora niente qui</p>
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
