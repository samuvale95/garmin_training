"use client";

import { SlideUp } from "@/components/motion/primitives";
import { FoodThumb, portionLabel } from "@/components/FuelCorrectionSheet";
import { formatClockTime } from "@/lib/format";
import type { FoodEntry } from "@/lib/types";

/** The meals logged today, as rows. (The day's plan -- what to eat, and when -- lives in
 * `FuelDayPlan`.) */

// ---- PASTI REGISTRATI (SOLO SE PRESENTI) ----------------------------------------------------

export function MealList({ entries, animate, onSelect }: { entries: FoodEntry[]; animate: boolean; onSelect: (e: FoodEntry) => void }) {
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--inchiostro-50)" }}>
          Pasti registrati ({entries.length})
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {entries.map((entry, i) => (
          <SlideUp key={entry.id} active={animate} delayMs={280 + i * 50} row>
            <MealRow entry={entry} onSelect={onSelect} />
          </SlideUp>
        ))}
      </div>
    </div>
  );
}

export function MealRow({ entry, onSelect }: { entry: FoodEntry; onSelect: (e: FoodEntry) => void }) {
  const low = entry.confidence === "low";
  return (
    <button data-track="fuel-blocks.onselect"
      type="button"
      onClick={() => onSelect(entry)}
      className="tap-target press-soft"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: "var(--crema)",
        border: low ? "1.5px dashed var(--sabbia-bordo)" : "var(--border-airbnb)",
        borderRadius: "var(--radius-row)",
        padding: 12,
        textAlign: "left",
        cursor: "pointer",
        boxShadow: "var(--shadow-airbnb-subtle)",
      }}
    >
      <FoodThumb entry={entry} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 13.5, margin: "0 0 2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: "var(--inchiostro)" }}>
          {entry.description ?? "Pasto"}
        </p>
        <p className="font-mono" style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: 0 }}>
          {entry.carb_g != null ? Math.round(entry.carb_g) : "—"} g C · {entry.protein_g != null ? Math.round(entry.protein_g) : "—"} g P
          {entry.portion !== 1 && ` · porzione ${portionLabel(entry.portion)}`}
        </p>
      </div>
      <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", flexShrink: 0 }}>
        {formatClockTime(entry.logged_at)}
      </span>
    </button>
  );
}
