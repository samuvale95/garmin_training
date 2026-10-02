"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { SunIcon, MoonIcon, RunnerIcon } from "@/components/Icons";
import { FoodThumb, portionLabel } from "@/components/FuelCorrectionSheet";
import { capitalize, formatClockTime } from "@/lib/format";
import type {
  DayTarget,
  ComplianceLine,
  DayTotals,
  DuringSession,
  FoodEntry,
  FuelTargets,
  RecoveryWindow,
  SessionLoad,
} from "@/lib/types";

export type RunTimeSlot = "mattina" | "pomeriggio" | "sera";

const LOAD_LABELS: Record<SessionLoad, string> = {
  riposo: "riposo",
  facile: "facile",
  moderato: "moderato",
  duro: "duro",
  molto_lungo: "molto lungo",
};

function formatRange(range: [number, number]): string {
  return `${range[0]}–${range[1]}`;
}

// ---- BLOCCO 1: SCHEDA SEDUTA & SELETTORE ORARIO -----------------------------------------------

export function SessionTimeSelectorCard({
  animate,
  fuel,
  timeSlot,
  onSelectTimeSlot,
}: {
  animate: boolean;
  fuel: FuelTargets;
  timeSlot: RunTimeSlot;
  onSelectTimeSlot: (slot: RunTimeSlot) => void;
}) {
  const t: DayTarget = fuel.today;
  const isRest = t.load === "riposo";
  const title = t.session_title ? capitalize(t.session_title) : isRest ? "Riposo attivo" : "Allenamento di oggi";
  const targetCarb = t.carb_g ? Math.round((t.carb_g[0] + t.carb_g[1]) / 2) : 250;

  return (
    <SlideUp active={animate} delayMs={80} style={{ marginTop: 14 }}>
      <div
        style={{
          background: "var(--crema-card)",
          border: "var(--border-airbnb)",
          borderRadius: 22,
          padding: "15px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 13,
          boxShadow: "var(--shadow-airbnb-subtle)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span
              className="font-mono"
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".05em",
                textTransform: "uppercase",
                background: "var(--corallo)",
                color: "var(--corallo-testo)",
                padding: "3px 8px",
                borderRadius: "var(--radius-pill)",
                flexShrink: 0,
              }}
            >
              OGGI
            </span>
            <span
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "var(--inchiostro)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {title}
            </span>
          </div>

          <div
            className="font-mono"
            style={{
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--inchiostro-70)",
              background: "var(--crema)",
              border: "var(--border-airbnb)",
              padding: "4px 9px",
              borderRadius: 100,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            Target: <strong style={{ color: "var(--inchiostro)" }}>~{targetCarb}g carbo</strong>
          </div>
        </div>

        {!isRest && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: ".05em",
                color: "var(--inchiostro-50)",
              }}
            >
              Quando prevedi di correre?
            </span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 5,
                background: "var(--sabbia)",
                padding: 3,
                borderRadius: 13,
              }}
            >
              <button
                type="button"
                onClick={() => onSelectTimeSlot("mattina")}
                style={{
                  border: "none",
                  background: timeSlot === "mattina" ? "var(--crema)" : "transparent",
                  color: timeSlot === "mattina" ? "var(--inchiostro)" : "var(--inchiostro-70)",
                  boxShadow: timeSlot === "mattina" ? "0 2px 5px rgba(0,0,0,0.06)" : "none",
                  padding: "7px 4px",
                  borderRadius: 10,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <SunIcon size={12} strokeWidth={2} />
                <span>Mattina</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTimeSlot("pomeriggio")}
                style={{
                  border: "none",
                  background: timeSlot === "pomeriggio" ? "var(--crema)" : "transparent",
                  color: timeSlot === "pomeriggio" ? "var(--inchiostro)" : "var(--inchiostro-70)",
                  boxShadow: timeSlot === "pomeriggio" ? "0 2px 5px rgba(0,0,0,0.06)" : "none",
                  padding: "7px 4px",
                  borderRadius: 10,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <SunIcon size={12} strokeWidth={2.4} />
                <span>Pomeriggio (18:00)</span>
              </button>

              <button
                type="button"
                onClick={() => onSelectTimeSlot("sera")}
                style={{
                  border: "none",
                  background: timeSlot === "sera" ? "var(--crema)" : "transparent",
                  color: timeSlot === "sera" ? "var(--inchiostro)" : "var(--inchiostro-70)",
                  boxShadow: timeSlot === "sera" ? "0 2px 5px rgba(0,0,0,0.06)" : "none",
                  padding: "7px 4px",
                  borderRadius: 10,
                  fontSize: 11.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  whiteSpace: "nowrap",
                  transition: "all 0.15s ease",
                }}
              >
                <MoonIcon size={12} strokeWidth={2} />
                <span>Sera</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </SlideUp>
  );
}

// ---- BLOCCO 2: TIMELINE DELLA GIORNATA (IL PROTAGONISTA) -------------------------------------

interface MealStep {
  tag: string;
  isPre?: boolean;
  isPost?: boolean;
  dish: string;
  tip: string;
  estimate: string;
}

export function DayFuelTimelineBlock({
  animate,
  fuel,
  timeSlot,
}: {
  animate: boolean;
  fuel: FuelTargets;
  timeSlot: RunTimeSlot;
}) {
  const t: DayTarget = fuel.today;
  const isRest = t.load === "riposo";
  const title = t.session_title ? capitalize(t.session_title) : "Corsa";
  const isLong = t.load === "molto_lungo" || t.load === "duro";

  let preRunMeals: MealStep[] = [];
  let runLabel = "";
  let runNote = "Solo acqua ed elettroliti";
  let postRunMeals: MealStep[] = [];

  if (isRest) {
    return (
      <div style={{ marginTop: 18 }}>
        <p className="font-mono" style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: "0 0 10px 2px" }}>
          La tua giornata di riposo
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <MealCard
            step={{
              tag: "Pranzo e Cena",
              dish: "Porzioni normali con carboidrati moderati",
              tip: "Oggi non c'è bisogno di carichi particolari. Mantieni un buon apporto di verdure e proteine.",
              estimate: "Ricarica regolare",
            }}
          />
        </div>
      </div>
    );
  }

  if (timeSlot === "mattina") {
    runLabel = "Ore 07:30 · " + title;
    runNote = isLong ? "Acqua + gel ogni 45 min" : "Solo acqua";
    preRunMeals = [
      {
        tag: "Prima di uscire (ore 07:00)",
        isPre: true,
        dish: "Acqua + 1 caffè o 2 biscotti / fette biscottate",
        tip: "Uno zuccherino leggero se non ami correre a digiuno, senza impegnare la digestione.",
        estimate: "~15g carbo",
      },
    ];
    postRunMeals = [
      {
        tag: "Colazione (ore 08:30) · Recupero",
        isPost: true,
        dish: "Porridge d'avena o pane tostato + yogurt / uova e frutto",
        tip: "Ricarica subito le gambe di carboidrati e dai proteine ai muscoli per rigenerarsi.",
        estimate: "~60g carbo + 20g prot",
      },
      {
        tag: "Pranzo (ore 13:00)",
        dish: "Pasta o riso (80–100g) con verdure e secondo",
        tip: "Completa la ricarica energetica della giornata.",
        estimate: "~80g carbo",
      },
    ];
  } else if (timeSlot === "sera") {
    runLabel = "Ore 20:00 · " + title;
    runNote = isLong ? "Acqua + gel" : "Solo acqua";
    preRunMeals = [
      {
        tag: "Pranzo (ore 13:00) · Base energetica",
        isPre: true,
        dish: "Pasta o riso (80–100g) condimento leggero",
        tip: "Costruisce le scorte di glicogeno che userai questa sera.",
        estimate: "~80g carbo",
      },
      {
        tag: "Merenda (ore 17:30) · 2h prima",
        isPre: true,
        dish: "Pane con marmellata o toast leggero + banana",
        tip: "Energia pronta per non arrivare alla corsa con la fame del pomeriggio.",
        estimate: "~45g carbo",
      },
    ];
    postRunMeals = [
      {
        tag: "Cena (ore 21:15) · Recupero",
        isPost: true,
        dish: "Secondo digeribile (pesce/uova/pollo) + riso o pane",
        tip: "Ripara le fibre muscolari prima del sonno senza appesantire la notte.",
        estimate: "~30g prot + carbo",
      },
    ];
  } else {
    // Pomeriggio (standard ore 18:00)
    runLabel = "Ore 18:00 · " + title;
    runNote = isLong ? "Acqua + 1 gel se >80 min" : "Solo acqua";
    preRunMeals = [
      {
        tag: "Pranzo (ore 13:00) · 2–3h prima",
        isPre: true,
        dish: "Pasta o riso (80–100g) al pomodoro fresco",
        tip: "Carboidrati digeribili per riempire i muscoli di energia senza appesantire lo stomaco.",
        estimate: "~80g carbo",
      },
      {
        tag: "Merenda (ore 17:00) · 1h prima",
        isPre: true,
        dish: "1 banana oppure pane e marmellata",
        tip: "Zuccheri pronti all'uso per partire senza cali di energia (solo se hai fame).",
        estimate: "~25g carbo",
      },
    ];
    postRunMeals = [
      {
        tag: "Cena (ore 20:00) · Recupero",
        isPost: true,
        dish: "Pesce o pollo (150g) + patate al forno o riso",
        tip: "Proteine per riparare le fibre muscolari e carboidrati per ripristinare le scorte consumate.",
        estimate: "~30g prot + carbo",
      },
    ];
  }

  return (
    <div style={{ marginTop: 18 }}>
      <p
        className="font-mono"
        style={{
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: ".08em",
          textTransform: "uppercase",
          color: "var(--inchiostro-50)",
          margin: "0 0 10px 2px",
        }}
      >
        La tua giornata alimentare
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {preRunMeals.map((meal) => (
          <MealCard key={meal.tag} step={meal} highlight={meal.isPre} />
        ))}

        {/* Workout marker in timeline */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            background: "var(--corallo-chiaro)",
            border: "1px dashed var(--corallo)",
            borderRadius: 14,
          }}
        >
          <RunnerIcon size={15} strokeWidth={2} style={{ color: "var(--corallo-testo)" }} />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--corallo-testo)" }}>
            {runLabel}
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              color: "var(--corallo-testo)",
              opacity: 0.85,
              marginLeft: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {runNote}
          </span>
        </div>

        {postRunMeals.map((meal) => (
          <MealCard key={meal.tag} step={meal} highlight={meal.isPost} />
        ))}
      </div>
    </div>
  );
}

function MealCard({ step, highlight = false }: { step: MealStep; highlight?: boolean }) {
  const dotColor = step.isPre ? "var(--corallo-testo)" : step.isPost ? "var(--verde-testo)" : "var(--inchiostro-50)";
  const tagColor = step.isPre ? "var(--corallo-testo)" : step.isPost ? "var(--verde-testo)" : "var(--inchiostro-70)";

  return (
    <div
      style={{
        background: highlight ? "var(--crema)" : "var(--crema-card)",
        border: highlight ? "1px solid rgba(0, 0, 0, 0.09)" : "var(--border-airbnb)",
        borderRadius: 18,
        padding: "14px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 5,
        boxShadow: highlight ? "0 4px 12px rgba(0, 0, 0, 0.04)" : "var(--shadow-airbnb-subtle)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".04em",
              color: tagColor,
              whiteSpace: "nowrap",
            }}
          >
            {step.tag}
          </span>
        </div>
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            color: "var(--inchiostro-50)",
            whiteSpace: "nowrap",
          }}
        >
          {step.estimate}
        </span>
      </div>

      <div style={{ fontSize: 14.5, fontWeight: 700, color: "var(--inchiostro)", lineHeight: 1.3 }}>
        {step.dish}
      </div>

      <div
        className="font-serif-italic"
        style={{
          fontSize: 13.5,
          color: "var(--inchiostro-70)",
          lineHeight: 1.35,
        }}
      >
        {step.tip}
      </div>
    </div>
  );
}

// ---- BLOCCO 3: DOMANI IN ARRIVO ---------------------------------------------------------------

export function TomorrowFuelBanner({ animate, fuel }: { animate: boolean; fuel: FuelTargets }) {
  const t = fuel.tomorrow;
  const isHardTomorrow = t.load === "duro" || t.load === "molto_lungo";
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Riposo" : "Allenamento";
  const targetTomorrow = t.carb_g ? Math.round((t.carb_g[0] + t.carb_g[1]) / 2) : 250;

  return (
    <SlideUp active={animate} delayMs={280} style={{ marginTop: 14 }}>
      <div
        style={{
          background: isHardTomorrow ? "var(--corallo-chiaro)" : "var(--sabbia)",
          border: "var(--border-airbnb)",
          borderRadius: 17,
          padding: "13px 15px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: isHardTomorrow ? "var(--corallo-testo)" : "var(--inchiostro-50)",
            }}
          >
            Domani · {title}
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--inchiostro)" }}>
            {isHardTomorrow ? "Stasera a cena aggiungi una porzione extra di carboidrati" : "Cena regolare senza carichi"}
          </span>
        </div>

        <span
          className="font-mono"
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            color: isHardTomorrow ? "var(--corallo-testo)" : "var(--inchiostro)",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          ~{targetTomorrow}g
        </span>
      </div>
    </SlideUp>
  );
}

// ---- PASTI REGISTRATI (SOLO SE PRESENTI) ----------------------------------------------------

export function MealList({ entries, animate, onSelect }: { entries: FoodEntry[]; animate: boolean; onSelect: (e: FoodEntry) => void }) {
  if (entries.length === 0) return null;

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
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
    <button
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
        <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: 0 }}>
          {entry.carb_g != null ? Math.round(entry.carb_g) : "—"} g C · {entry.protein_g != null ? Math.round(entry.protein_g) : "—"} g P
          {entry.portion !== 1 && ` · porzione ${portionLabel(entry.portion)}`}
        </p>
      </div>
      <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", flexShrink: 0 }}>
        {formatClockTime(entry.logged_at)}
      </span>
    </button>
  );
}
