"use client";

import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { ChevronRight, PlusIcon } from "@/components/Icons";
import { capitalize } from "@/lib/format";
import { inHowLong, isUrgent, portionsInline, type Moment } from "@/lib/fuelMoment";
import type { FuelTargets } from "@/lib/types";

/** The meal that matters right now, on the home screen: breakfast at eight, the snack
 * at half past ten, the plate before the run, the one after it.
 *
 * Same rule and same plates as the Nutrizione tab (`currentMoment`, `meal_plan`) --
 * this is the one line of it worth seeing without opening that tab. When it is urgent
 * (to eat now or within the hour, or the meal that answers to the session) it is dark
 * and sits right under the session; otherwise it is a quiet row further down. Once the
 * day's meals are over it says nothing.
 */
export function NowMealCard({
  fuel,
  moment,
  onLog,
  animate,
  delayMs = 0,
}: {
  fuel: FuelTargets;
  moment: Moment;
  onLog: () => void;
  animate: boolean;
  delayMs?: number;
}) {
  if (moment.kind === "done") return null;
  const urgent = isUrgent(moment);
  const dark = urgent;

  let overline: string;
  let title: string;
  let body: string | null;
  let badge: string | null = null;

  if (moment.kind === "session") {
    const during = fuel.during;
    const after = fuel.meals.find((meal) => meal.role === "post");
    overline = `Allenamento previsto · ${fuel.session_clock}`;
    title = during?.carb_g_per_hour ? `${during.carb_g_per_hour[0]}–${during.carb_g_per_hour[1]} g di carboidrati all'ora` : "Solo acqua";
    body = after ? `Dopo, alle ${after.clock}: ${after.name.toLowerCase()} — ${portionsInline(after.portions)}` : null;
  } else {
    const { meal } = moment;
    overline = moment.now
      ? `Adesso · ${meal.clock}`
      : moment.minutesUntil != null
        ? `Prossimo pasto · ${inHowLong(moment.minutesUntil)}`
        : `Prossimo pasto · ${meal.clock}`;
    title = meal.name;
    body = meal.portions.length ? portionsInline(meal.portions) : null;
    badge = meal.role === "pre" ? "prima dell'allenamento" : meal.role === "post" ? "recupero" : null;
  }

  const muted = dark ? "var(--inchiostro-su-scuro)" : "var(--inchiostro-50)";

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{
        marginTop: 12,
        background: dark ? "var(--inchiostro)" : "var(--crema-card)",
        color: dark ? "var(--crema)" : "var(--inchiostro)",
        border: dark ? "none" : "var(--border-airbnb)",
        borderRadius: "var(--radius-card)",
        boxShadow: dark ? "var(--shadow-airbnb-card)" : "var(--shadow-airbnb-subtle)",
        overflow: "hidden",
      }}
    >
      <Link
        data-track="today.now-meal"
        href="/nutrition"
        className="press-soft"
        style={{ display: "block", padding: "14px 16px 12px", color: "inherit", textDecoration: "none" }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span
            className="font-mono"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: dark ? "#ff8fa6" : "var(--corallo-accent)" }}
          >
            {urgent && <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />}
            {overline}
          </span>
          {badge && (
            <span style={{ fontSize: 10.5, fontWeight: 700, background: "var(--corallo-accent)", color: "#fff", borderRadius: "var(--radius-pill)", padding: "2px 9px", whiteSpace: "nowrap" }}>
              {badge}
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 6 }}>
          <p style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-.015em", margin: 0 }}>{capitalize(title)}</p>
          <ChevronRight size={16} style={{ color: muted, flex: "none" }} />
        </div>
        {body && <p style={{ fontSize: 14, lineHeight: 1.4, fontWeight: 500, color: dark ? "var(--crema)" : "var(--inchiostro-70)", margin: "4px 0 0" }}>{body}</p>}
      </Link>
      {moment.kind === "meal" && (
        <button
          data-track="today.now-meal-log"
          type="button"
          onClick={onLog}
          className="tap-target"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            width: "100%",
            background: "none",
            border: "none",
            borderTop: dark ? "1px solid rgba(255,255,255,.12)" : "1px solid var(--sabbia-bordo)",
            color: dark ? "var(--crema)" : "var(--inchiostro)",
            padding: "10px 16px",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <PlusIcon size={14} strokeWidth={2.2} />
          <span>Registra cosa hai mangiato</span>
        </button>
      )}
    </SlideUp>
  );
}
