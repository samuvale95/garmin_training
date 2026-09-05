"use client";

import type { CSSProperties, ReactNode } from "react";
import { BarGrow, ProgressRing, SlideUp } from "@/components/motion/primitives";
import { FoodThumb } from "@/components/FuelCorrectionSheet";
import { capitalize, formatClockTime, formatFullDate } from "@/lib/format";
import type { DayTarget, DayTotals, FoodEntry, FuelTargets, SessionLoad } from "@/lib/types";

// The presentational half of /body/fuel: everything the screen shows when it is *not*
// in the middle of the photo flow. Kept out of the route file so the flow states
// (camera -> estimating -> review) and the resting screen stop competing for the same
// 600-line file, and so each block can be looked at on its own.

const LOAD_LABELS: Record<SessionLoad, string> = {
  riposo: "riposo",
  facile: "facile",
  moderato: "moderato",
  duro: "duro",
  molto_lungo: "molto lungo",
};

/** The g/kg scale the hero's range bar is drawn on. 12 is above anything
 * `nutrition.py` ever answers (the top band is 8-10 g/kg), so a real range always
 * lands inside the track with room to spare rather than pinning to its right edge. */
const CARB_SCALE_MAX = 12;

function formatRange(range: [number, number]): string {
  return `${range[0]}–${range[1]}`;
}

// ---- C1: hero "domani" ---------------------------------------------------------------------

/** Where tomorrow's g/kg band sits on the 0-12 scale -- the one piece of the hero that
 * says "this is a big day" without needing the reader to know what 7 g/kg means. */
function CarbScale({ range, animate, onDark }: { range: [number, number]; animate: boolean; onDark: boolean }) {
  const left = (Math.min(range[0], CARB_SCALE_MAX) / CARB_SCALE_MAX) * 100;
  const right = (Math.min(range[1], CARB_SCALE_MAX) / CARB_SCALE_MAX) * 100;
  // A band of zero width (both ends equal, e.g. a flat rest-day target) would draw
  // nothing at all -- give it the width of the track's own cap instead.
  const width = Math.max(right - left, 4);
  const trackColor = onDark ? "rgba(246,238,218,.16)" : "var(--sabbia-scura)";

  return (
    <div style={{ position: "relative", height: 6, borderRadius: 100, background: trackColor, marginTop: 14 }}>
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

export function FuelHero({ animate, fuel, narrativeText }: { animate: boolean; fuel: FuelTargets; narrativeText?: string }) {
  const degraded = fuel.weight_source === "reference";
  const t = fuel.tomorrow;
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Riposo" : "Allenamento";
  const muted = degraded ? "var(--inchiostro-70)" : "var(--inchiostro-su-scuro)";

  return (
    <SlideUp
      active={animate}
      delayMs={100}
      style={{
        position: "relative",
        overflow: "hidden",
        background: degraded ? "var(--sabbia)" : "var(--inchiostro)",
        color: degraded ? "var(--inchiostro)" : "var(--crema)",
        borderRadius: "var(--radius-card-lg)",
        padding: 22,
        marginTop: 16,
      }}
    >
      {/* A single soft coral wash in the top corner: the dark card was a flat black
          rectangle, and this is the cheapest way to give it depth without inventing a
          color -- it is the same corallo the numbers are drawn in, at 22%. */}
      {!degraded && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -110,
            right: -70,
            width: 260,
            height: 260,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(247,148,112,.26), rgba(247,148,112,0) 68%)",
            pointerEvents: "none",
          }}
        />
      )}

      <div style={{ position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <span className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: muted }}>
            domani
          </span>
          <span
            style={{
              background: degraded ? "var(--sabbia-chip)" : "rgba(246,238,218,.12)",
              color: degraded ? "var(--inchiostro-70)" : "var(--crema)",
              borderRadius: "var(--radius-pill)",
              padding: "4px 11px",
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {LOAD_LABELS[t.load]}
          </span>
        </div>

        <p style={{ font: "600 26px/1.1 var(--font-outfit)", letterSpacing: "-.02em", margin: "8px 0 2px" }}>{title}</p>
        <p style={{ fontSize: 12.5, color: muted, margin: 0 }}>{formatFullDate(t.date)}</p>

        {t.carb_g ? (
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "0 9px", marginTop: 18 }}>
            <span
              className="font-mono"
              style={{ fontSize: 42, fontWeight: 500, lineHeight: 1, letterSpacing: "-.03em", color: "var(--corallo)" }}
            >
              {formatRange(t.carb_g)}
            </span>
            <span style={{ fontSize: 15, color: degraded ? "var(--inchiostro-70)" : "var(--crema)" }}>g di carboidrati</span>
          </div>
        ) : (
          <p style={{ fontSize: 15, margin: "18px 0 0" }}>
            Senza il tuo peso posso darti solo il rapporto, non i grammi.
          </p>
        )}

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
          <span className="font-mono" style={{ fontSize: 13, color: muted }}>
            {formatRange(t.carb_g_per_kg)} g per kg
          </span>
          {degraded && (
            <span style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
              su 70 kg di riferimento
            </span>
          )}
        </div>

        <CarbScale range={t.carb_g_per_kg} animate={animate} onDark={!degraded} />

        <p className="font-serif-italic" style={{ fontSize: 16, lineHeight: 1.35, margin: "16px 0 0", color: degraded ? "var(--inchiostro-70)" : "var(--crema)" }}>
          {narrativeText ?? fuel.advice}
        </p>
      </div>
    </SlideUp>
  );
}

// ---- C2: "oggi" ------------------------------------------------------------------------------

const RING_SIZE = 108;

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

/** The empty state deliberately doesn't render a zero-length fill: an empty bar next
 * to a target reads as a debt, which is exactly what this screen must not do (see the
 * brief's "target del giorno, non un debito"). A dashed rule says "this is where the
 * day's bar will be" without claiming anything about progress. */
function StartTrack() {
  return (
    <div
      aria-hidden="true"
      style={{
        height: 3,
        marginTop: 11,
        borderRadius: 100,
        background: "repeating-linear-gradient(to right, var(--neutro-barra) 0 7px, transparent 7px 13px)",
      }}
    />
  );
}

function TargetHeadline({ range, color }: { range: [number, number] | null; color: string }) {
  return (
    <div style={{ background: "var(--sabbia)", borderRadius: "var(--radius-chip)", padding: "14px 16px" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <MacroLabel color={color}>carboidrati</MacroLabel>
        {range && (
          <span className="font-mono" style={{ fontSize: 25, fontWeight: 500, letterSpacing: "-.02em" }}>
            {formatRange(range)} <span style={{ fontSize: 13, fontWeight: 400, color: "var(--inchiostro-50)" }}>g</span>
          </span>
        )}
      </div>
      <StartTrack />
    </div>
  );
}

function TargetTile({ label, range, color }: { label: string; range: [number, number] | null; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, background: "var(--sabbia)", borderRadius: "var(--radius-chip)", padding: "13px 14px" }}>
      <MacroLabel color={color}>{label}</MacroLabel>
      {range && (
        <p className="font-mono" style={{ fontSize: 18, fontWeight: 500, letterSpacing: "-.02em", margin: "7px 0 0", whiteSpace: "nowrap" }}>
          {formatRange(range)} <span style={{ fontSize: 11.5, fontWeight: 400, color: "var(--inchiostro-50)" }}>g</span>
        </p>
      )}
      <StartTrack />
    </div>
  );
}

function MacroBar({ label, value, range, color, animate, delayMs }: { label: string; value: number; range: [number, number] | null; color: string; animate: boolean; delayMs: number }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <MacroLabel color={color}>{label}</MacroLabel>
        <span className="font-mono" style={{ fontSize: 13.5 }}>
          {Math.round(value)} <span style={{ color: "var(--inchiostro-50)", fontSize: 11.5 }}>g</span>
        </span>
      </div>
      <div style={{ marginTop: 7 }}>
        <BarGrow value={range ? value / range[1] : 0} color={color} trackColor="var(--sabbia-chip)" height={7} active={animate} delayMs={delayMs} />
      </div>
      {range && (
        <p className="font-mono" style={{ fontSize: 10.5, color: "var(--inchiostro-35)", margin: "5px 0 0" }}>
          su {formatRange(range)} g
        </p>
      )}
    </div>
  );
}

export function TodayFuelBlock({ animate, fuel, totals, hasPlan }: { animate: boolean; fuel: FuelTargets; totals: DayTotals | undefined; hasPlan: boolean }) {
  const t: DayTarget = fuel.today;
  const hasEntries = !!totals && totals.entries > 0;
  const subtitle = !hasPlan ? "nessun piano" : t.session_title ? t.session_title.toLowerCase() : LOAD_LABELS[t.load];

  return (
    <SlideUp active={animate} delayMs={240} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <p style={{ font: "600 18px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0 }}>Oggi</p>
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            color: "var(--inchiostro-70)",
            background: "var(--sabbia-chip)",
            borderRadius: "var(--radius-pill)",
            padding: "5px 11px",
            maxWidth: "62%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {subtitle}
        </span>
      </div>

      {!hasPlan && <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "10px 0 0" }}>Senza sapere cosa corri uso i valori di mantenimento.</p>}

      {hasEntries && totals ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 16 }}>
            <MacroLabel color={MACRO_COLORS.carb}>carboidrati</MacroLabel>
            <span style={{ background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", flex: "none" }}>stima</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
            <div style={{ flex: "none", textAlign: "center" }}>
              <ProgressRing key={Math.round(totals.carb_g)} value={t.carb_g ? totals.carb_g / t.carb_g[1] : 0} size={RING_SIZE} strokeWidth={11} trackColor="var(--sabbia-chip)">
                <div style={{ textAlign: "center" }}>
                  <p className="font-mono" style={{ fontSize: 27, fontWeight: 500, letterSpacing: "-.02em", margin: 0 }}>{Math.round(totals.carb_g)}</p>
                  <p style={{ fontSize: 10, color: "var(--inchiostro-50)", margin: 0 }}>g carbo</p>
                </div>
              </ProgressRing>
              {t.carb_g && (
                <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)", margin: "8px 0 0" }}>
                  su {formatRange(t.carb_g)} g
                </p>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0, marginTop: -14 }}>
              <MacroBar label="proteine" value={totals.protein_g} range={t.protein_g} color={MACRO_COLORS.protein} animate={animate} delayMs={320} />
              <MacroBar label="grassi" value={totals.fat_g} range={t.fat_g} color={MACRO_COLORS.fat} animate={animate} delayMs={400} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div style={{ marginTop: 14 }}>
            <TargetHeadline range={t.carb_g} color={MACRO_COLORS.carb} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <TargetTile label="proteine" range={t.protein_g} color={MACRO_COLORS.protein} />
            <TargetTile label="grassi" range={t.fat_g} color={MACRO_COLORS.fat} />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "12px 0 0", lineHeight: 1.4 }}>
            {hasPlan && "Non hai ancora fotografato niente. "}Questi sono i target del giorno, non un debito.
          </p>
        </>
      )}
    </SlideUp>
  );
}

// ---- C3: meal list ---------------------------------------------------------------------------

export function MealList({ entries, animate, onSelect }: { entries: FoodEntry[]; animate: boolean; onSelect: (e: FoodEntry) => void }) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>Pasti di oggi</span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          {entries.length} {entries.length === 1 ? "voce" : "voci"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {entries.map((entry, i) => (
          <SlideUp key={entry.id} active={animate} delayMs={300 + i * 60} row>
            <MealRow entry={entry} onSelect={onSelect} />
          </SlideUp>
        ))}
      </div>
    </div>
  );
}

function MealRow({ entry, onSelect }: { entry: FoodEntry; onSelect: (e: FoodEntry) => void }) {
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
        border: low ? "1.5px dashed var(--sabbia-bordo)" : "1.5px solid transparent",
        borderRadius: "var(--radius-row)",
        padding: 12,
        textAlign: "left",
        cursor: "pointer",
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
          {entry.protein_g != null ? Math.round(entry.protein_g) : "—"} g P
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{formatClockTime(entry.logged_at)}</span>
        <ConfidenceBadge entry={entry} />
      </div>
    </button>
  );
}

function ConfidenceBadge({ entry }: { entry: FoodEntry }) {
  if (entry.corrected) return <Chip background="var(--sabbia-chip)" color="var(--inchiostro-70)">corretto da te</Chip>;
  if (entry.confidence === "low") return <Chip background="var(--rosa-avviso)" color="var(--rosso-testo)">bassa</Chip>;
  if (entry.confidence === "medium") return <Chip background="var(--sabbia-chip)" color="var(--inchiostro-70)">media</Chip>;
  if (entry.confidence === "high") return <Chip background="var(--verde)" color="var(--verde-testo)">alta</Chip>;
  return null;
}

function Chip({ background, color, children }: { background: string; color: string; children: ReactNode }) {
  return <span style={{ background, color, borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 11, fontWeight: 700, flex: "none" }}>{children}</span>;
}

// ---- C5: comment -----------------------------------------------------------------------------

/** Only ever rendered with text the hero isn't already showing -- the two used to print
 * the same sentence twice, one under the other, whenever the model's narrative was the
 * only line available. */
export function FuelComment({ animate, text, style }: { animate: boolean; text: string; style?: CSSProperties }) {
  return (
    <SlideUp active={animate} delayMs={380} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14, ...style }}>
      <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.35, color: "var(--inchiostro-70)", margin: 0 }}>
        {text}
      </p>
    </SlideUp>
  );
}
