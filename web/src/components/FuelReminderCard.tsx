"use client";

import { SlideUp } from "@/components/motion/primitives";
import { BellIcon, DropletIcon, UtensilsIcon } from "@/components/Icons";
import { PushControl } from "@/components/PushControl";
import { usePushState, type PushState } from "@/lib/push";
import { calculateHydrationMl } from "@/lib/notifications";
import type { DayTarget, MealSlot } from "@/lib/types";

interface FuelReminderCardProps {
  todayTarget?: DayTarget | null;
  /** "18:00": where the session sits in today's plan (`FuelTargets.session_clock`). */
  sessionClock: string | null;
  /** The plan's own pre-session meal. The snack shown here *is* that meal -- a second
   * time and a second gram count computed in this file used to sit under the plan and
   * disagree with it. */
  preMeal: MealSlot | null;
  animate?: boolean;
  delayMs?: number;
}

function subtractMinutes(clock: string, minsToSubtract: number): string {
  const [hour, minute] = clock.split(":").map(Number);
  let totalMins = hour * 60 + minute - minsToSubtract;
  if (totalMins < 0) totalMins += 24 * 60;
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function FuelReminderCard({
  todayTarget,
  sessionClock,
  preMeal,
  animate = true,
  delayMs = 0,
}: FuelReminderCardProps) {
  const { state } = usePushState();

  if (!todayTarget || todayTarget.load === "riposo" || !sessionClock) {
    return null;
  }

  const waterTime = subtractMinutes(sessionClock, 45);
  const hydrationMl = calculateHydrationMl(todayTarget.duration_minutes, todayTarget.load === "molto_lungo");
  const snackFoods = preMeal?.portions.map((p) => (p.grams != null ? `${p.food} ${p.grams} g` : p.food)).join(", ");

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{
        background: "var(--crema-card)",
        borderRadius: "var(--radius-card-lg)",
        padding: 20,
        border: "1px solid rgba(34, 34, 34, 0.06)",
        marginTop: 18,
      }}
    >
      {/* Title & Status */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: ".05em",
            color: "var(--inchiostro-50)",
          }}
        >
          Promemoria Merenda & Idratazione
        </p>

        <StatePill state={state} />
      </div>

      <p style={{ font: "600 17px/1.2 var(--font-sans)", letterSpacing: "-.01em", margin: "0 0 4px" }}>
        Programma pre-corsa (uscita alle {sessionClock})
      </p>
      <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: "0 0 14px", lineHeight: 1.4 }}>
        Il carburante e i liquidi fanno effetto se arrivano con il giusto anticipo rispetto alla partenza.
      </p>

      {/* Two steps: Snack and Water */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0" }}>
        {/* Snack block: the plan's pre-session meal, not a second opinion on it */}
        {preMeal ? (
          <div style={{ background: "var(--giallo)", padding: 12, borderRadius: "var(--radius-card)" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--giallo-testo)", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <UtensilsIcon size={11} strokeWidth={2.2} />
                <span>Prima</span>
              </span>
              <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--giallo-testo)" }}>
                ore {preMeal.clock}
              </span>
            </div>
            <p className="font-mono" style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 2px", color: "var(--giallo-testo)" }}>
              ~{preMeal.carb_g} g carbo
            </p>
            {snackFoods && (
              <span style={{ fontSize: 10.5, color: "var(--inchiostro-70)", lineHeight: 1.3, display: "block" }}>
                {snackFoods.charAt(0).toUpperCase() + snackFoods.slice(1)}
              </span>
            )}
          </div>
        ) : (
          <div />
        )}

        {/* Hydration block */}
        <div style={{ background: "var(--azzurro)", padding: 12, borderRadius: "var(--radius-card)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--azzurro-testo)", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <DropletIcon size={11} strokeWidth={2.2} />
              <span>Acqua (−45&apos;)</span>
            </span>
            <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: "var(--azzurro-testo)" }}>
              ore {waterTime}
            </span>
          </div>
          <p className="font-mono" style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 2px", color: "var(--azzurro-testo)" }}>
            ~{hydrationMl} ml
          </p>
          <span style={{ fontSize: 10.5, color: "var(--inchiostro-70)", lineHeight: 1.3, display: "block" }}>
            1–2 bicchieri d&apos;acqua a piccoli sorsi per non appesantire lo stomaco.
          </span>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <PushControl compact />
      </div>
    </SlideUp>
  );
}

function StatePill({ state }: { state: PushState | null }) {
  const look =
    state === "on"
      ? { bg: "var(--verde)", fg: "var(--verde-testo)", text: "Attivi" }
      : state === "denied"
        ? { bg: "var(--rosa-avviso)", fg: "var(--rosso-testo)", text: "Bloccati" }
        : state === "needs-install"
          ? { bg: "var(--giallo)", fg: "var(--giallo-testo)", text: "Installa l'app" }
          : { bg: "rgba(34, 34, 34, 0.05)", fg: "var(--inchiostro-50)", text: "Da attivare" };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 9px",
        borderRadius: "var(--radius-pill)",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        background: look.bg,
        color: look.fg,
      }}
    >
      {state === "on" && <BellIcon size={12} strokeWidth={2.4} />}
      {look.text}
    </span>
  );
}
