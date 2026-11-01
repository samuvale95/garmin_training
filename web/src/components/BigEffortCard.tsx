"use client";

import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { ChevronRight } from "@/components/Icons";
import type { CompletedActivity } from "@/lib/types";

// A run this long is worth reading the morning after; anything shorter stays in the list.
const BIG_EFFORT_KM = 15;
const BIG_EFFORT_MIN = 90;
const RUNNING = /run/i;

export function bigEffort(activities: CompletedActivity[] | undefined): CompletedActivity | null {
  const runs = (activities ?? []).filter(
    (a) => RUNNING.test(a.sport) && ((a.distance_km ?? 0) >= BIG_EFFORT_KM || (a.duration_min ?? 0) >= BIG_EFFORT_MIN),
  );
  return runs.sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
}

function label(a: CompletedActivity): string {
  const km = a.distance_km ?? 0;
  if (Math.abs(km - 42.2) < 1) return "La tua maratona";
  if (Math.abs(km - 21.1) < 0.6) return "La tua mezza maratona";
  return "Il tuo lungo";
}

function duration(min: number | null): string {
  if (!min) return "";
  const total = Math.round(min * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}'` : `${m}'`;
}

/** The day after a long run or a race, its analysis leads the home screen. */
export function BigEffortCard({
  activity,
  dayLabel,
  animate,
}: {
  activity: CompletedActivity;
  dayLabel: string;
  animate: boolean;
}) {
  return (
    <SlideUp active={animate} delayMs={90} style={{ marginTop: 12 }}>
      <Link
        href={`/coach?activity=${activity.activity_id}`}
        data-track="today.big-effort"
        className="press-soft"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          textDecoration: "none",
          color: "var(--verde-testo)",
          background: "linear-gradient(160deg, var(--verde) 0%, var(--verde-chiaro) 100%)",
          borderRadius: "var(--radius-card-lg)",
          padding: "16px 18px",
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.8 }}>
            {label(activity)} · {dayLabel}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
            <span className="font-mono" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>
              {activity.distance_km?.toFixed(1)} km
            </span>
            <span className="font-mono" style={{ fontSize: 14, opacity: 0.85 }}>
              {duration(activity.duration_min)}
            </span>
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>Com&apos;è andata, metà per metà e km per km</div>
        </div>
        <ChevronRight size={20} />
      </Link>
    </SlideUp>
  );
}
