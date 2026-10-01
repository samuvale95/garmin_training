"use client";

import { type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { SlideUp } from "@/components/motion/primitives";
import { TiltCard } from "@/components/motion/TiltCard";
import { FoodThumb } from "@/components/FuelCorrectionSheet";
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

// Design System Passo 2026: Ultra-clean, modern Airbnb-style elevation, high glanceability,
// zero wall-of-text. Built for runners to understand what they need in 2 seconds.

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

// ---- BLOCCO 1: OGGI (HERO SIGNATURE DARK PASSO) ---------------------------------------------

export function TodayFuelBlock({
  animate,
  fuel,
  totals,
  hasPlan,
  level = 2,
  lines = [],
}: {
  animate: boolean;
  fuel: FuelTargets;
  totals: DayTotals | undefined;
  hasPlan: boolean;
  level?: number;
  lines?: ComplianceLine[];
}) {
  const t: DayTarget = fuel.today;
  const hasEntries = !!totals && totals.entries > 0;
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Riposo attivo" : "Allenamento di oggi";
  const degraded = fuel.weight_source === "reference";

  const carbLogged = Math.round(totals?.carb_g ?? 0);
  const carbTarget = t.carb_g;
  const carbRemaining = carbTarget ? Math.max(0, carbTarget[0] - carbLogged) : 0;
  const carbPct = carbTarget ? Math.min(1, carbLogged / carbTarget[1]) : 0;

  return (
    <SlideUp active={animate} delayMs={80} style={{ marginTop: 14 }}>
      <TiltCard
        maxTilt={3}
        style={{
          background: "var(--inchiostro)",
          color: "var(--crema)",
          borderRadius: 26,
          padding: 22,
          boxShadow: "0 10px 28px rgba(0, 0, 0, 0.12)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Top header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".06em",
              textTransform: "uppercase",
              background: "rgba(255, 255, 255, 0.15)",
              color: "var(--crema)",
              borderRadius: "var(--radius-pill)",
              padding: "4px 10px",
            }}
          >
            OGGI
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--inchiostro-su-scuro)" }}>
            {title} · {LOAD_LABELS[t.load]}
          </span>
        </div>

        {/* Main Metric */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: ".05em",
              color: "var(--inchiostro-su-scuro)",
            }}
          >
            Fabbisogno stimato
          </span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              className="font-mono"
              style={{
                fontSize: 38,
                fontWeight: 700,
                letterSpacing: "-.03em",
                color: "var(--corallo)",
                lineHeight: 1,
              }}
            >
              {carbTarget ? formatRange(carbTarget) : "210–280"}
            </span>
            <span style={{ fontSize: 15, fontWeight: 500, color: "var(--crema)" }}>
              g di carboidrati
            </span>
          </div>
        </div>

        {/* Macro row */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            paddingTop: 14,
            borderTop: "1px solid rgba(255, 255, 255, 0.1)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)" }}>Proteine</span>
            <span className="font-mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--crema)" }}>
              {t.protein_g ? formatRange(t.protein_g) : "110–125"} g
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)" }}>Grassi buoni</span>
            <span className="font-mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--crema)" }}>
              {t.fat_g ? formatRange(t.fat_g) : "55–70"} g
            </span>
          </div>
        </div>

        {/* Progress line if user has logged */}
        {hasEntries && totals ? (
          <div style={{ background: "rgba(255, 255, 255, 0.08)", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 500 }}>
              <span style={{ color: "var(--corallo)" }}>Registrati: <strong>{carbLogged} g</strong></span>
              <span style={{ color: "var(--inchiostro-su-scuro)" }}>{carbRemaining > 0 ? `Mancano ~${carbRemaining} g` : "Target raggiunto ✓"}</span>
            </div>
            <div style={{ height: 4, borderRadius: 10, background: "rgba(255, 255, 255, 0.15)", overflow: "hidden", marginTop: 6 }}>
              <div style={{ width: `${carbPct * 100}%`, height: "100%", background: "var(--corallo)", borderRadius: 10 }} />
            </div>
          </div>
        ) : null}

        {degraded && (
          <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: 0 }}>
            Calcolato su 70 kg di riferimento · <Link href="/settings/body" style={{ color: "var(--corallo)", textDecoration: "underline" }}>Imposta peso reale</Link>
          </p>
        )}
      </TiltCard>
    </SlideUp>
  );
}

// ---- BLOCCO 2: INTORNO ALL'ALLENAMENTO (3 RIGHE ULTRA-PULITE) --------------------------------

export function FoodEquivalencesBlock({ animate }: { animate: boolean }) {
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
        Intorno all&apos;allenamento
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
        {/* Step 1: Pre-allenamento */}
        <SlideUp active={animate} delayMs={140}>
          <div
            style={{
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              borderRadius: 18,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  color: "var(--corallo-testo)",
                }}
              >
                2–3h prima
              </span>
              <span
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: "var(--inchiostro)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Pasta o riso (80–100g)
              </span>
            </div>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                color: "var(--inchiostro-50)",
                background: "var(--crema)",
                border: "var(--border-airbnb)",
                padding: "4px 10px",
                borderRadius: 100,
                flexShrink: 0,
              }}
            >
              ~75g carbo
            </span>
          </div>
        </SlideUp>

        {/* Step 2: Snack veloce */}
        <SlideUp active={animate} delayMs={190}>
          <div
            style={{
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              borderRadius: 18,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  color: "var(--giallo-testo)",
                }}
              >
                1h prima (se serve)
              </span>
              <span
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: "var(--inchiostro)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Banana o pane con miele
              </span>
            </div>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                color: "var(--inchiostro-50)",
                background: "var(--crema)",
                border: "var(--border-airbnb)",
                padding: "4px 10px",
                borderRadius: 100,
                flexShrink: 0,
              }}
            >
              ~25g carbo
            </span>
          </div>
        </SlideUp>

        {/* Step 3: Recupero post-corsa */}
        <SlideUp active={animate} delayMs={240}>
          <div
            style={{
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              borderRadius: 18,
              padding: "14px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span
                className="font-mono"
                style={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  color: "var(--verde-testo)",
                }}
              >
                Dopo la corsa
              </span>
              <span
                style={{
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: "var(--inchiostro)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                Proteine + patate o riso
              </span>
            </div>
            <span
              className="font-mono"
              style={{
                fontSize: 12,
                color: "var(--inchiostro-50)",
                background: "var(--crema)",
                border: "var(--border-airbnb)",
                padding: "4px 10px",
                borderRadius: 100,
                flexShrink: 0,
              }}
            >
              recupero
            </span>
          </div>
        </SlideUp>
      </div>
    </div>
  );
}

// ---- BLOCCO 3: DOMANI (ANTEPRIMA SINTETICA IN 1 ROW) -------------------------------------------

export function FuelHero({ animate, fuel, narrativeText }: { animate: boolean; fuel: FuelTargets; narrativeText?: string }) {
  const t = fuel.tomorrow;
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Riposo" : "Allenamento";
  const isHardTomorrow = t.load === "duro" || t.load === "molto_lungo";

  return (
    <SlideUp active={animate} delayMs={280} style={{ marginTop: 14 }}>
      <div
        style={{
          background: isHardTomorrow ? "var(--corallo-chiaro)" : "var(--sabbia)",
          border: "var(--border-airbnb)",
          borderRadius: 20,
          padding: "15px 18px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span
            className="font-mono"
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: ".06em",
              color: isHardTomorrow ? "var(--corallo-testo)" : "var(--inchiostro-50)",
            }}
          >
            Domani · {title}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--inchiostro)" }}>
            {isHardTomorrow ? "Stasera fai il pieno a cena" : "Cena regolare"}
          </span>
          <span
            className="font-serif-italic"
            style={{
              fontSize: 13,
              color: isHardTomorrow ? "var(--corallo-testo)" : "var(--inchiostro-70)",
            }}
          >
            {isHardTomorrow ? "Una porzione abbondante di carboidrati" : "Domani seduta leggera o riposo"}
          </span>
        </div>

        {t.carb_g && (
          <span
            className="font-mono"
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: isHardTomorrow ? "var(--corallo-testo)" : "var(--inchiostro)",
              flexShrink: 0,
            }}
          >
            ~{Math.round((t.carb_g[0] + t.carb_g[1]) / 2)}g
          </span>
        )}
      </div>
    </SlideUp>
  );
}

// ---- DURANTE E DOPO (SOLO SE LUNGO) -----------------------------------------------------------

export function SessionFuelBlock({ animate, during, recovery }: { animate: boolean; during: DuringSession | null; recovery: RecoveryWindow | null }) {
  if (!during && !recovery) return null;
  return (
    <div style={{ marginTop: 12 }}>
      {during && (
        <SlideUp active={animate} delayMs={310}>
          <div style={{ background: "var(--corallo-chiaro)", border: "var(--border-airbnb)", borderRadius: 18, padding: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="font-mono" style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "var(--corallo-testo)" }}>
                Durante la corsa di oggi
              </span>
              <span className="font-mono" style={{ fontSize: 12, fontWeight: 600, color: "var(--corallo-testo)" }}>
                {during.carb_g_per_hour[0]}–{during.carb_g_per_hour[1]} g/ora
              </span>
            </div>
            <p style={{ fontSize: 12.5, margin: "4px 0 0", color: "var(--corallo-testo)" }}>
              {during.note}
            </p>
          </div>
        </SlideUp>
      )}
    </div>
  );
}

// ---- FABBISOGNO ENERGETICO ------------------------------------------------------------------

export function EnergyBlock({ animate, target }: { animate: boolean; target: DayTarget }) {
  const energy = target.energy;
  if (!energy || energy.need_kcal == null) return null;

  return (
    <SlideUp active={animate} delayMs={330} style={{ marginTop: 12 }}>
      <div style={{ background: "var(--crema)", border: "var(--border-airbnb)", borderRadius: "var(--radius-card)", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "var(--inchiostro-50)" }}>Stima consumo totale</span>
          <p className="font-mono" style={{ fontSize: 18, fontWeight: 700, margin: "2px 0 0", color: "var(--inchiostro)" }}>
            {energy.need_kcal.toLocaleString("it-IT")} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--inchiostro-50)" }}>kcal</span>
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>Seduta di oggi</span>
          <p className="font-mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--corallo-testo)", margin: "2px 0 0" }}>
            ~{energy.training_kcal} kcal
          </p>
        </div>
      </div>
    </SlideUp>
  );
}

// ---- PASTI REGISTRATI -----------------------------------------------------------------------

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
        </p>
      </div>
      <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", flexShrink: 0 }}>
        {formatClockTime(entry.logged_at)}
      </span>
    </button>
  );
}

export function FuelComment({ animate, text, style }: { animate: boolean; text: string; style?: CSSProperties }) {
  return null;
}
