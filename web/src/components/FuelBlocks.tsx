"use client";

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { BarGrow, ProgressRing, SlideUp } from "@/components/motion/primitives";
import { FoodThumb } from "@/components/FuelCorrectionSheet";
import { capitalize, formatClockTime, formatFullDate } from "@/lib/format";
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

// The presentational half of /body/fuel: everything the screen shows when it is *not*
// in the middle of the photo flow. Kept out of the route file so the flow states
// (camera -> estimating -> review) and the resting screen stop competing for the same
// file, and so each block can be looked at on its own.

const LOAD_LABELS: Record<SessionLoad, string> = {
  riposo: "riposo",
  facile: "facile",
  moderato: "moderato",
  duro: "duro",
  molto_lungo: "molto lungo",
};

/** The g/kg scale the range bar is drawn on. 10 is above anything
 * `nutrition.py` ever answers -- top band is 6.5-8.0 g/kg, plus at most 1 g/kg bonus. */
const CARB_SCALE_MAX = 10;

function formatRange(range: [number, number]): string {
  return `${range[0]}–${range[1]}`;
}

const MACRO_COLORS = {
  carb: "var(--corallo)",
  protein: "var(--azzurro-tratto)",
  fat: "var(--lilla)",
} as const;

function MacroLabel({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--inchiostro-50)" }}>
      <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color, flex: "none" }} />
      {children}
    </span>
  );
}

/** Where a g/kg band sits on the scale. */
function CarbScale({ range, animate, onDark = false }: { range: [number, number]; animate: boolean; onDark?: boolean }) {
  const left = (Math.min(range[0], CARB_SCALE_MAX) / CARB_SCALE_MAX) * 100;
  const right = (Math.min(range[1], CARB_SCALE_MAX) / CARB_SCALE_MAX) * 100;
  const width = Math.max(right - left, 5);
  const trackColor = onDark ? "rgba(246,238,218,.16)" : "var(--sabbia-scura)";

  return (
    <div style={{ position: "relative", height: 6, borderRadius: 100, background: trackColor, marginTop: 12 }}>
      <div style={{ position: "absolute", inset: 0, left: `${left}%`, width: `${width}%` }}>
        <div
          className={animate ? "anim-bar-grow" : undefined}
          style={{
            height: "100%",
            borderRadius: 100,
            background: "var(--corallo)",
            transformOrigin: "left",
            animationDelay: animate ? "260ms" : undefined,
          }}
        />
      </div>
    </div>
  );
}

function MacroBar({
  label,
  value,
  range,
  color,
  animate,
  delayMs,
  onDark = false,
}: {
  label: string;
  value: number;
  range: [number, number] | null;
  color: string;
  animate: boolean;
  delayMs: number;
  onDark?: boolean;
}) {
  const textColor = onDark ? "var(--crema)" : "var(--inchiostro)";
  const mutedColor = onDark ? "var(--inchiostro-su-scuro)" : "var(--inchiostro-50)";
  const trackColor = onDark ? "rgba(246,238,218,.14)" : "var(--sabbia-chip)";

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: mutedColor }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: color, flex: "none" }} />
          {label}
        </span>
        <span className="font-mono" style={{ fontSize: 13.5, color: textColor }}>
          {Math.round(value)} <span style={{ color: mutedColor, fontSize: 11.5 }}>g</span>
        </span>
      </div>
      <div style={{ marginTop: 6 }}>
        <BarGrow value={range ? Math.min(1.2, value / range[1]) : 0} color={color} trackColor={trackColor} height={6} active={animate} delayMs={delayMs} />
      </div>
      {range && (
        <p className="font-mono" style={{ fontSize: 10.5, color: mutedColor, margin: "4px 0 0" }}>
          target {formatRange(range)} g
        </p>
      )}
    </div>
  );
}

// ---- HERO PRINCIPALE: OGGI -------------------------------------------------------------------

const RING_SIZE = 112;

export function TodayFuelBlock({
  animate,
  fuel,
  totals,
  hasPlan,
  lines = [],
}: {
  animate: boolean;
  fuel: FuelTargets;
  totals: DayTotals | undefined;
  hasPlan: boolean;
  lines?: ComplianceLine[];
}) {
  const t: DayTarget = fuel.today;
  const hasEntries = !!totals && totals.entries > 0;
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Giorno di riposo" : "Allenamento di oggi";
  const degraded = fuel.weight_source === "reference";

  const carbLogged = Math.round(totals?.carb_g ?? 0);
  const carbTarget = t.carb_g;
  const carbRemaining = carbTarget ? Math.max(0, carbTarget[0] - carbLogged) : 0;
  const carbPct = carbTarget ? Math.min(1.25, carbLogged / carbTarget[1]) : 0;

  return (
    <SlideUp
      active={animate}
      delayMs={80}
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--inchiostro)",
        color: "var(--crema)",
        borderRadius: "var(--radius-card-lg)",
        padding: 22,
        marginTop: 16,
        boxShadow: "0 8px 24px rgba(28,26,22,.12)",
      }}
    >
      {/* Soft coral ambient wash */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -100,
          right: -60,
          width: 250,
          height: 250,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(247,148,112,.22), rgba(247,148,112,0) 70%)",
          pointerEvents: "none",
        }}
      />

      <div style={{ position: "relative" }}>
        {/* Header line */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="font-mono"
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                letterSpacing: ".08em",
                textTransform: "uppercase",
                background: "var(--corallo)",
                color: "var(--corallo-testo)",
                borderRadius: "var(--radius-pill)",
                padding: "3px 9px",
              }}
            >
              OGGI
            </span>
            <span style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>
              {formatFullDate(t.date)}
            </span>
          </div>

          <span
            style={{
              background: "rgba(246,238,218,.12)",
              color: "var(--crema)",
              borderRadius: "var(--radius-pill)",
              padding: "4px 11px",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {LOAD_LABELS[t.load]}
          </span>
        </div>

        {/* Session title */}
        <h2 style={{ font: "600 24px/1.15 var(--font-sans)", letterSpacing: "-.02em", margin: "10px 0 2px" }}>
          {title}
        </h2>
        {t.duration_minutes ? (
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-su-scuro)", margin: 0 }}>
            {Math.round(t.duration_minutes)} minuti stimati
          </p>
        ) : null}

        {/* Main Macro Section */}
        {hasEntries && totals ? (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
              {/* Carb ring */}
              <div style={{ flex: "none", textAlign: "center" }}>
                <ProgressRing key={carbLogged} value={carbPct} size={RING_SIZE} strokeWidth={11} trackColor="rgba(246,238,218,.14)">
                  <div style={{ textAlign: "center" }}>
                    <p className="font-mono" style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-.02em", margin: 0, color: "var(--corallo)" }}>
                      {carbLogged}
                    </p>
                    <p style={{ fontSize: 10.5, color: "var(--inchiostro-su-scuro)", margin: "1px 0 0" }}>g carbo</p>
                  </div>
                </ProgressRing>
                {carbTarget && (
                  <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: "8px 0 0" }}>
                    su {formatRange(carbTarget)} g
                  </p>
                )}
              </div>

              {/* Protein & Fat bars */}
              <div style={{ flex: 1, minWidth: 0, marginTop: -8 }}>
                <MacroBar
                  label="Proteine"
                  value={totals.protein_g}
                  range={t.protein_g}
                  color={MACRO_COLORS.protein}
                  animate={animate}
                  delayMs={240}
                  onDark
                />
                <MacroBar
                  label="Grassi"
                  value={totals.fat_g}
                  range={t.fat_g}
                  color={MACRO_COLORS.fat}
                  animate={animate}
                  delayMs={320}
                  onDark
                />
              </div>
            </div>

            {/* Remaining carbs badge */}
            {carbTarget && (
              <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(246,238,218,.08)", borderRadius: "var(--radius-chip)", padding: "10px 14px" }}>
                <span style={{ fontSize: 12.5, color: "var(--crema)" }}>
                  {carbRemaining > 0 ? (
                    <>Mancano <strong style={{ color: "var(--corallo)" }}>{carbRemaining} g</strong> di carboidrati per il target</>
                  ) : (
                    <span style={{ color: "var(--verde)" }}>✓ Obiettivo carboidrati raggiunto per oggi</span>
                  )}
                </span>
                <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-su-scuro)" }}>
                  {formatRange(t.carb_g_per_kg)} g/kg
                </span>
              </div>
            )}

            {/* Compliance lines */}
            {lines.length > 0 && (
              <ul style={{ listStyle: "none", padding: 0, margin: "14px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                {lines.map((line) => (
                  <li
                    key={line.macro}
                    style={{
                      fontSize: 12.5,
                      lineHeight: 1.4,
                      color: line.flagged ? "var(--corallo)" : "var(--inchiostro-su-scuro)",
                      fontWeight: line.flagged ? 600 : 400,
                      paddingLeft: 10,
                      borderLeft: `2.5px solid ${line.status === "sotto" ? (line.flagged ? "var(--corallo)" : "rgba(246,238,218,.25)") : "var(--verde)"}`,
                    }}
                  >
                    {line.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          /* Empty state: clear targets to hit */
          <div style={{ marginTop: 18 }}>
            <div style={{ background: "rgba(246,238,218,.08)", borderRadius: "var(--radius-card)", padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--corallo)", flex: "none" }} />
                  Carboidrati consigliati
                </span>
                {carbTarget && (
                  <span className="font-mono" style={{ fontSize: 24, fontWeight: 500, color: "var(--corallo)" }}>
                    {formatRange(carbTarget)} <span style={{ fontSize: 13, color: "var(--inchiostro-su-scuro)" }}>g</span>
                  </span>
                )}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                <span style={{ fontSize: 11.5, color: "var(--inchiostro-su-scuro)" }}>
                  {formatRange(t.carb_g_per_kg)} g per kg di peso
                </span>
                <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)" }}>
                  fabbisogno per {LOAD_LABELS[t.load]}
                </span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
              <div style={{ flex: 1, background: "rgba(246,238,218,.08)", borderRadius: "var(--radius-card)", padding: "12px 14px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--inchiostro-su-scuro)" }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: MACRO_COLORS.protein, flex: "none" }} />
                  Proteine
                </span>
                {t.protein_g && (
                  <p className="font-mono" style={{ fontSize: 18, fontWeight: 500, margin: "6px 0 0", color: "var(--crema)" }}>
                    {formatRange(t.protein_g)} <span style={{ fontSize: 11.5, color: "var(--inchiostro-su-scuro)" }}>g</span>
                  </p>
                )}
              </div>
              <div style={{ flex: 1, background: "rgba(246,238,218,.08)", borderRadius: "var(--radius-card)", padding: "12px 14px" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--inchiostro-su-scuro)" }}>
                  <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: MACRO_COLORS.fat, flex: "none" }} />
                  Grassi
                </span>
                {t.fat_g && (
                  <p className="font-mono" style={{ fontSize: 18, fontWeight: 500, margin: "6px 0 0", color: "var(--crema)" }}>
                    {formatRange(t.fat_g)} <span style={{ fontSize: 11.5, color: "var(--inchiostro-su-scuro)" }}>g</span>
                  </p>
                )}
              </div>
            </div>

            <p style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)", margin: "14px 0 0", lineHeight: 1.45 }}>
              {!hasPlan ? "Nessun piano importato: valori di mantenimento generale. " : "Nessun pasto registrato oggi. "}
              Questi numeri sono una guida per rifornire i muscoli, non un tetto da non superare.
            </p>
          </div>
        )}

        {/* Degraded reference weight note */}
        {degraded && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "rgba(235,178,74,.15)", borderRadius: "var(--radius-chip)", padding: "8px 12px" }}>
            <span style={{ fontSize: 11.5, color: "var(--giallo)" }}>
              Calcolato su 70 kg di riferimento
            </span>
            <Link href="/settings/body" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--giallo)", textDecoration: "underline" }}>
              Imposta il tuo peso
            </Link>
          </div>
        )}
      </div>
    </SlideUp>
  );
}

// ---- SECONDA CARD: PREPARAZIONE PER DOMANI ---------------------------------------------------

export function FuelHero({ animate, fuel, narrativeText }: { animate: boolean; fuel: FuelTargets; narrativeText?: string }) {
  const t = fuel.tomorrow;
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Riposo" : "Allenamento in programma";

  const isHardTomorrow = t.load === "duro" || t.load === "molto_lungo";

  return (
    <SlideUp
      active={animate}
      delayMs={160}
      style={{
        background: "var(--crema-card)",
        border: "1px solid var(--border-airbnb)",
        boxShadow: "var(--shadow-airbnb-subtle)",
        borderRadius: "var(--radius-card-lg)",
        padding: 20,
        marginTop: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", fontWeight: 600 }}>
            Preparazione per domani
          </span>
        </div>
        <span
          style={{
            background: isHardTomorrow ? "var(--corallo)" : "var(--sabbia-chip)",
            color: isHardTomorrow ? "var(--corallo-testo)" : "var(--inchiostro-70)",
            borderRadius: "var(--radius-pill)",
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {LOAD_LABELS[t.load]}
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <div>
          <p style={{ font: "600 18px/1.2 var(--font-sans)", letterSpacing: "-.01em", margin: 0 }}>
            {title}
          </p>
          <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "3px 0 0" }}>
            {formatFullDate(t.date)}
          </p>
        </div>

        {t.carb_g && (
          <div style={{ textAlign: "right", flex: "none" }}>
            <span className="font-mono" style={{ fontSize: 20, fontWeight: 600, color: "var(--inchiostro)" }}>
              {formatRange(t.carb_g)} <span style={{ fontSize: 12, fontWeight: 400, color: "var(--inchiostro-50)" }}>g</span>
            </span>
            <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: 0 }}>
              {formatRange(t.carb_g_per_kg)} g/kg
            </p>
          </div>
        )}
      </div>

      <CarbScale range={t.carb_g_per_kg} animate={animate} />

      <p className="font-serif-italic" style={{ fontSize: 14, lineHeight: 1.4, margin: "14px 0 0", color: "var(--inchiostro-70)" }}>
        {narrativeText ?? fuel.advice}
      </p>
    </SlideUp>
  );
}

// ---- TERZA CARD: DURANTE E DOPO LA SEDUTA ----------------------------------------------------

export function SessionFuelBlock({ animate, during, recovery }: { animate: boolean; during: DuringSession | null; recovery: RecoveryWindow | null }) {
  if (!during && !recovery) return null;
  return (
    <div style={{ marginTop: 14 }}>
      {during && (
        <SlideUp active={animate} delayMs={220} style={{ background: "var(--corallo)", color: "var(--corallo-testo)", borderRadius: "var(--radius-card)", padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.85, margin: 0, fontWeight: 700 }}>
              Durante la seduta di oggi
            </p>
            <span className="font-mono" style={{ fontSize: 11, opacity: 0.85 }}>
              totale {during.total_carb_g[0]}–{during.total_carb_g[1]} g
            </span>
          </div>
          <p className="font-mono" style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em", margin: "6px 0 2px" }}>
            {during.carb_g_per_hour[0]}–{during.carb_g_per_hour[1]} <span style={{ fontSize: 13, fontWeight: 400 }}>g all&apos;ora</span>
          </p>
          <p style={{ fontSize: 12.5, margin: 0, opacity: 0.9 }}>
            {during.note}
          </p>
        </SlideUp>
      )}
      {recovery && (
        <SlideUp active={animate} delayMs={260} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: during ? 10 : 0 }}>
          <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0, fontWeight: 700 }}>
            Finestra di recupero post-corsa
          </p>
          <p className="font-mono" style={{ fontSize: 16, fontWeight: 500, margin: "6px 0 2px" }}>
            {recovery.carb_g} g carboidrati · {recovery.protein_g} g proteine
          </p>
          <p style={{ fontSize: 12, color: "var(--inchiostro-70)", margin: 0 }}>
            {recovery.note}
          </p>
        </SlideUp>
      )}
    </div>
  );
}

// ---- QUARTA CARD: BILANCIO ENERGETICO --------------------------------------------------------

export function EnergyBlock({ animate, target }: { animate: boolean; target: DayTarget }) {
  const energy = target.energy;
  if (!energy || energy.need_kcal == null) return null;

  const midpoint = Math.round((energy.target_kcal[0] + energy.target_kcal[1]) / 2);
  const living = energy.need_kcal - energy.training_kcal;

  return (
    <SlideUp active={animate} delayMs={280} style={{ background: "var(--crema-card)", border: "1px solid var(--border-airbnb)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p style={{ font: "600 17px/1 var(--font-sans)", letterSpacing: "-.01em", margin: 0 }}>Fabbisogno Energetico</p>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>stima fisiologica</span>
      </div>

      <div style={{ display: "flex", alignItems: "flex-end", gap: 18, marginTop: 14 }}>
        <div>
          <p className="font-mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", margin: 0 }}>
            {energy.need_kcal.toLocaleString("it-IT")}
          </p>
          <p style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>kcal costo della giornata</p>
        </div>
        <span aria-hidden="true" style={{ fontSize: 18, color: "var(--inchiostro-35)", paddingBottom: 12 }}>·</span>
        <div>
          <p className="font-mono" style={{ fontSize: 26, fontWeight: 600, letterSpacing: "-.02em", margin: 0, color: "var(--corallo-testo)" }}>
            {midpoint.toLocaleString("it-IT")}
          </p>
          <p style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>kcal nei target sopra</p>
        </div>
      </div>

      <div style={{ display: "flex", height: 7, borderRadius: 100, overflow: "hidden", marginTop: 14 }}>
        <div style={{ width: `${(living / energy.need_kcal) * 100}%`, background: "var(--azzurro-tratto)" }} />
        <div style={{ width: `${(energy.training_kcal / energy.need_kcal) * 100}%`, background: "var(--corallo)" }} />
      </div>
      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        <MacroLabel color="var(--azzurro-tratto)">
          {living.toLocaleString("it-IT")} kcal vita quotidiana
        </MacroLabel>
        <MacroLabel color="var(--corallo-testo)">
          {energy.training_kcal.toLocaleString("it-IT")} kcal seduta di corsa
        </MacroLabel>
      </div>

      {energy.trimmed && (
        <p style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-chip)", padding: "10px 12px", fontSize: 12, margin: "12px 0 0", lineHeight: 1.4 }}>
          I carboidrati sono stati calibrati per evitare eccessi calorici rispetto a quanto speso.
        </p>
      )}
    </SlideUp>
  );
}

// ---- PASTI LOGGATI ---------------------------------------------------------------------------

export function MealList({ entries, animate, onSelect }: { entries: FoodEntry[]; animate: boolean; onSelect: (e: FoodEntry) => void }) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
          Pasti registrati oggi
        </span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          {entries.length} {entries.length === 1 ? "voce" : "voci"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
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
        background: "var(--crema-card)",
        border: low ? "1.5px dashed var(--sabbia-bordo)" : "1px solid var(--border-airbnb)",
        borderRadius: "var(--radius-row)",
        padding: 12,
        textAlign: "left",
        cursor: "pointer",
        boxShadow: "var(--shadow-airbnb-subtle)",
      }}
    >
      <FoodThumb entry={entry} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: low ? "var(--inchiostro-70)" : "var(--inchiostro)" }}>
          {entry.description ?? "Pasto"}
        </p>
        <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>
          {low && "~"}
          {entry.carb_g != null ? Math.round(entry.carb_g) : "—"} g C · {low && "~"}
          {entry.protein_g != null ? Math.round(entry.protein_g) : "—"} g P · {low && "~"}
          {entry.fat_g != null ? Math.round(entry.fat_g) : "—"} g G
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
        <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)" }}>{formatClockTime(entry.logged_at)}</span>
        <ConfidenceBadge entry={entry} />
      </div>
    </button>
  );
}

function ConfidenceBadge({ entry }: { entry: FoodEntry }) {
  if (entry.corrected) return <Chip background="var(--sabbia-chip)" color="var(--inchiostro-70)">modificato</Chip>;
  if (entry.confidence === "low") return <Chip background="var(--rosa-avviso)" color="var(--rosso-testo)">stima approssimata</Chip>;
  if (entry.confidence === "medium") return <Chip background="var(--sabbia-chip)" color="var(--inchiostro-70)">stima media</Chip>;
  if (entry.confidence === "high") return <Chip background="var(--verde)" color="var(--verde-testo)">preciso</Chip>;
  return null;
}

function Chip({ background, color, children }: { background: string; color: string; children: ReactNode }) {
  return <span style={{ background, color, borderRadius: "var(--radius-pill)", padding: "3px 9px", fontSize: 10.5, fontWeight: 700, flex: "none" }}>{children}</span>;
}

export function FuelComment({ animate, text, style }: { animate: boolean; text: string; style?: CSSProperties }) {
  return (
    <SlideUp active={animate} delayMs={340} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14, ...style }}>
      <p className="font-serif-italic" style={{ fontSize: 14, lineHeight: 1.4, color: "var(--inchiostro-70)", margin: 0 }}>
        {text}
      </p>
    </SlideUp>
  );
}
