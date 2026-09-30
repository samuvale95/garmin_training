"use client";

import { SlideUp } from "@/components/motion/primitives";
import { TiltCard } from "@/components/motion/TiltCard";
import type { DayEnergy } from "@/lib/types";

const SOURCE_LABELS: Record<string, string> = { garmin: "Garmin", strava: "Strava", stima: "stima" };

/** "La tua giornata": every activity of the day with its calories and where they come
 * from, what the day cost (Garmin's figure when there is one, the estimate otherwise, the
 * other shown next to it), and what was logged to eat (see `training_plan/energy.py`).
 * At level 1, words only: no kilocalories while the habit is being built. */
export function DayEnergyCard({ energy, numbers, animate, delayMs = 0 }: { energy: DayEnergy; numbers: boolean; animate: boolean; delayMs?: number }) {
  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 12 }}>
      <TiltCard
        maxTilt={4.5}
        style={{
          background: "var(--crema)",
          border: "var(--border-airbnb)",
          borderRadius: "var(--radius-card-lg)",
          padding: 18,
        }}
      >
        <p style={{ font: "600 18px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0 }}>La tua giornata</p>

      {energy.activities.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
          {energy.activities.map((activity, i) => (
            <li key={`${activity.title}-${i}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5 }}>
              <span>
                {activity.title} <span style={{ color: "var(--inchiostro-50)" }}>· {Math.round(activity.minutes)}&apos;</span>
              </span>
              {numbers && (
                <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-70)", flex: "none" }}>
                  {activity.kcal} kcal <span style={{ color: "var(--inchiostro-35)" }}>{SOURCE_LABELS[activity.source]}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {numbers && (
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <Figure label={energy.spent_source === "garmin" ? "Spese (Garmin)" : "Spese (stima)"} value={energy.spent_kcal} />
          <Figure label="Mangiate" value={energy.intake_kcal} muted={energy.entries === 0} />
        </div>
      )}
      {numbers && energy.spent_source === "garmin" && (
        <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>
          la nostra stima: {energy.estimate_kcal} kcal (riposo {energy.estimate_bmr_kcal}, attività {energy.activities_kcal}, passi {energy.estimate_steps_kcal})
        </p>
      )}

      <p
        className="font-serif-italic"
        style={{ fontSize: 14, lineHeight: 1.4, margin: "12px 0 0", color: energy.missing_kcal ? "var(--inchiostro)" : "var(--inchiostro-70)" }}
      >
        {numbers ? energy.message : energy.words}
      </p>
      </TiltCard>
    </SlideUp>
  );
}

function Figure({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div style={{ flex: 1, background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 12, opacity: muted ? 0.6 : 1 }}>
      <p style={{ font: "500 11px var(--font-outfit)", color: "var(--inchiostro-50)", margin: 0 }}>{label}</p>
      <p className="font-mono" style={{ fontSize: 20, fontWeight: 500, margin: "6px 0 0" }}>
        {value} <span style={{ fontSize: 11 }}>kcal</span>
      </p>
    </div>
  );
}
