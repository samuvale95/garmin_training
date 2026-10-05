"use client";

import { formatShortDate } from "@/lib/format";
import { shiftDateKey } from "@/lib/sessionVisuals";

export type LogDay = "oggi" | "ieri";

/** Until this hour a new meal defaults to yesterday: a dinner logged after midnight
 * belongs to the evening it was eaten, not to the day that has just started. */
const LATE_NIGHT_UNTIL_HOUR = 4;

export function defaultLogDay(now: Date = new Date()): LogDay {
  return now.getHours() < LATE_NIGHT_UNTIL_HOUR ? "ieri" : "oggi";
}

export function logDateKey(todayKey: string, day: LogDay): string {
  return day === "ieri" ? shiftDateKey(todayKey, -1) : todayKey;
}

/** "Per quando è questo pasto": today or yesterday, with the date spelled out so the
 * choice can't be misread around midnight. */
export function LogDayPicker({ todayKey, value, onChange }: { todayKey: string; value: LogDay; onChange: (day: LogDay) => void }) {
  const options: { day: LogDay; label: string }[] = [
    { day: "ieri", label: `Ieri · ${formatShortDate(logDateKey(todayKey, "ieri"))}` },
    { day: "oggi", label: `Oggi · ${formatShortDate(todayKey)}` },
  ];
  return (
    <div role="radiogroup" aria-label="Giorno del pasto" style={{ display: "flex", gap: 6 }}>
      {options.map(({ day, label }) => {
        const selected = day === value;
        return (
          <button data-track="log-day-picker.onchange"
            key={day}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(day)}
            className="tap-target"
            style={{
              flex: 1,
              minHeight: 36,
              border: "none",
              borderRadius: "var(--radius-pill)",
              background: selected ? "var(--inchiostro)" : "var(--sabbia-chip)",
              color: selected ? "var(--crema)" : "var(--inchiostro)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
