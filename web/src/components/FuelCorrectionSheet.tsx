"use client";

import { useState, type CSSProperties } from "react";
import { useMotionEnabled } from "@/lib/motion";
import { apiUrl } from "@/lib/apiClient";
import { formatClockTime } from "@/lib/format";
import { useDeleteEntry, useUpdateEntry } from "@/lib/queries";
import type { FoodEntry } from "@/lib/types";

/** A meal's thumbnail: the stored photo, or a plain swatch for a manual entry (SPEC.md
 * §C3: "nell'implementazione ci va image_url" -- the mock's camera-icon swatches were a
 * design-time stand-in for a real thumbnail, not the intended final look). */
export function FoodThumb({ entry, size = 52 }: { entry: FoodEntry; size?: number }) {
  if (entry.image_url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- backend-served file, not an optimizable asset
      <img
        src={apiUrl(entry.image_url)}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, borderRadius: 14, objectFit: "cover", flex: "none" }}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: 14, background: "var(--sabbia-chip)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", fontSize: size * 0.4 }}
    >
      🍽️
    </div>
  );
}

/** How each entry says where its numbers came from. */
export const SOURCE_LABELS: Record<string, string> = {
  photo: "da foto",
  text: "dal testo",
  manual: "scritto a mano",
};

/** The quick choices for "how much of it did you eat". Multiples of the plate:
 * 50% (Metà), 75% (Tre quarti), 100% (Intera), 125% (Abbondante), 150% (Una e mezza), 200% (Doppia). */
export const PORTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function portionDescriptor(portion: number): string {
  if (portion <= 0.3) return "Un assaggio";
  if (portion <= 0.6) return "Mezza porzione";
  if (portion <= 0.85) return "Porzione leggera";
  if (portion >= 0.95 && portion <= 1.05) return "Porzione standard";
  if (portion <= 1.35) return "Abbondante";
  if (portion <= 1.65) return "Una e mezza";
  if (portion <= 2.2) return "Doppia porzione";
  return `${Math.round(portion * 100)}% del piatto`;
}

export function portionLabel(portion: number): string {
  const pct = Math.round(portion * 100);
  return `${pct}%`;
}

/** A macro field's text at a new portion. Recomputed from the saved entry while the user
 * hasn't typed over it (no rounding drift from repeated taps); once they have, their own
 * number is what gets scaled. */
export function macroAtPortion(saved: number | null, savedPortion: number, typed: string, edited: boolean, from: number, to: number): string {
  if (!edited) return saved != null ? String(Math.round((saved / savedPortion) * to)) : "";
  return typed === "" ? "" : String(Math.round((Number(typed) / from) * to));
}

/** "Quanto ne hai mangiato": sleek interactive stepper with percentage pill presets. */
export function PortionPicker({ value, onChange, disabled }: { value: number; onChange: (portion: number) => void; disabled?: boolean }) {
  const currentPct = Math.round(value * 100);
  const descriptor = portionDescriptor(value);

  const handleStep = (delta: number) => {
    if (disabled) return;
    const next = Math.max(0.1, Math.min(3.0, Math.round((value + delta) * 100) / 100));
    onChange(next);
  };

  return (
    <div
      style={{
        background: "var(--crema-card)",
        borderRadius: "var(--radius-card)",
        padding: "16px 16px 14px",
        border: "1px solid rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--inchiostro-50)" }}>
          Porzione consumata
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--inchiostro-70)" }}>
          {descriptor}
        </span>
      </div>

      {/* Main Stepper Card */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "var(--crema)",
          borderRadius: "var(--radius-chip)",
          padding: "6px 8px",
          boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
          border: "1px solid rgba(0,0,0,0.05)",
          marginBottom: 12,
        }}
      >
        <button
          type="button"
          aria-label="Diminuisci porzione"
          disabled={disabled || value <= 0.25}
          onClick={() => handleStep(-0.25)}
          className="tap-target"
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-chip)",
            border: "none",
            background: "var(--sabbia)",
            color: "var(--inchiostro)",
            fontSize: 20,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: disabled || value <= 0.25 ? "not-allowed" : "pointer",
            opacity: disabled || value <= 0.25 ? 0.35 : 1,
            transition: "background 0.15s ease, transform 0.1s ease",
          }}
        >
          −
        </button>

        <div style={{ textAlign: "center", flex: 1, padding: "0 8px" }}>
          <div style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
            <span className="font-mono" style={{ fontSize: 26, fontWeight: 800, color: "var(--inchiostro)", letterSpacing: "-0.03em" }}>
              {currentPct}
            </span>
            <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--inchiostro-50)" }}>
              %
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 11, color: "var(--inchiostro-50)", fontWeight: 500 }}>
            {value === 1 ? "1 piatto intero" : `×${value.toLocaleString("it-IT", { maximumFractionDigits: 2 })}`}
          </p>
        </div>

        <button
          type="button"
          aria-label="Aumenta porzione"
          disabled={disabled || value >= 3.0}
          onClick={() => handleStep(0.25)}
          className="tap-target"
          style={{
            width: 44,
            height: 44,
            borderRadius: "var(--radius-chip)",
            border: "none",
            background: "var(--sabbia)",
            color: "var(--inchiostro)",
            fontSize: 20,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: disabled || value >= 3.0 ? "not-allowed" : "pointer",
            opacity: disabled || value >= 3.0 ? 0.35 : 1,
            transition: "background 0.15s ease, transform 0.1s ease",
          }}
        >
          +
        </button>
      </div>

      {/* Quick selection presets */}
      <div
        role="radiogroup"
        aria-label="Scelta rapida porzione"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6, 1fr)",
          gap: 6,
        }}
      >
        {PORTIONS.map((option) => {
          const selected = Math.abs(option - value) < 0.01;
          const pct = Math.round(option * 100);
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(option)}
              className="tap-target"
              style={{
                height: 38,
                border: "none",
                borderRadius: "var(--radius-chip)",
                background: selected ? "var(--inchiostro)" : "rgba(0,0,0,0.035)",
                color: selected ? "var(--crema)" : "var(--inchiostro)",
                fontSize: 12,
                fontWeight: selected ? 700 : 500,
                cursor: disabled ? "default" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                transition: "all 0.15s ease",
                boxShadow: selected ? "0 2px 8px rgba(0,0,0,0.12)" : "none",
              }}
            >
              <span className="font-mono">{pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function digitsOnly(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function MacroField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-chip)", padding: 12 }}>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 4px" }}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(digitsOnly(e.target.value))}
          placeholder="—"
          className="font-mono"
          style={{ width: "100%", fontSize: 22, fontWeight: 500, border: "none", background: "none", padding: 0, outline: "none", color: "var(--inchiostro)" }}
        />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>g</span>
      </div>
    </div>
  );
}

/** Screen E1 -- correcting (or deleting) one logged meal, or saying how much of it was
 * eaten. Changing a number or the description marks the entry `corrected`, which is
 * what tells the rest of the app (and any future estimate) to stop touching it; changing
 * only the portion does not -- see EntryPatchRequest's docstring in schemas.py. */
export function FuelCorrectionSheet({ entry, onClose }: { entry: FoodEntry; onClose: () => void }) {
  const { reduced } = useMotionEnabled();
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const [description, setDescription] = useState(entry.description ?? "");
  const [carb, setCarb] = useState(entry.carb_g != null ? String(Math.round(entry.carb_g)) : "");
  const [protein, setProtein] = useState(entry.protein_g != null ? String(Math.round(entry.protein_g)) : "");
  const [fat, setFat] = useState(entry.fat_g != null ? String(Math.round(entry.fat_g)) : "");
  const [portion, setPortion] = useState(entry.portion);
  const [macrosEdited, setMacrosEdited] = useState(false);

  const busy = updateEntry.isPending || deleteEntry.isPending;

  function edit(setter: (v: string) => void) {
    return (v: string) => {
      setMacrosEdited(true);
      setter(v);
    };
  }

  function choosePortion(next: number) {
    setCarb(macroAtPortion(entry.carb_g, entry.portion, carb, macrosEdited, portion, next));
    setProtein(macroAtPortion(entry.protein_g, entry.portion, protein, macrosEdited, portion, next));
    setFat(macroAtPortion(entry.fat_g, entry.portion, fat, macrosEdited, portion, next));
    setPortion(next);
  }

  function save() {
    // Only what actually changed goes up: a portion alone rescales the stored numbers
    // server-side and leaves the entry an estimate; typed macros are taken as meant for
    // the new portion.
    const patch: Parameters<typeof updateEntry.mutate>[0] = { id: entry.id };
    const trimmed = description.trim() || null;
    if (trimmed !== (entry.description ?? null)) patch.description = trimmed;
    if (macrosEdited) {
      patch.carb_g = carb === "" ? null : Number(carb);
      patch.protein_g = protein === "" ? null : Number(protein);
      patch.fat_g = fat === "" ? null : Number(fat);
    }
    if (portion !== entry.portion) patch.portion = portion;
    if (Object.keys(patch).length === 1) {
      onClose();
      return;
    }
    updateEntry.mutate(patch, { onSuccess: onClose });
  }

  function remove() {
    deleteEntry.mutate(entry.id, { onSuccess: onClose });
  }

  const sheetStyle: CSSProperties = {
    width: "100%",
    maxHeight: "88dvh",
    overflowY: "auto",
    background: "var(--crema)",
    borderRadius: "24px 24px 0 0",
    padding: "12px 20px calc(28px + env(safe-area-inset-bottom, 0px))",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    boxShadow: "var(--shadow-airbnb-floating)",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(28,26,22,.45)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "flex-end",
        zIndex: 40,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={reduced ? undefined : "anim-slide-up"}
        style={sheetStyle}
      >
        <div style={{ width: 36, height: 4, borderRadius: 100, background: "var(--sabbia-bordo)", margin: "0 auto" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <FoodThumb entry={entry} />
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Editable, not a heading: a model's description is a guess like its
                numbers are, and the diary is where a wrong one gets fixed. */}
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Cos'era?"
              style={{ width: "100%", fontWeight: 600, fontSize: 15, border: "none", background: "none", padding: 0, outline: "none", color: "var(--inchiostro)", marginBottom: 2 }}
            />
            <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>
              {formatClockTime(entry.logged_at)} · {SOURCE_LABELS[entry.source] ?? "scritto a mano"}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <MacroField label="carbo" value={carb} onChange={edit(setCarb)} />
          <MacroField label="proteine" value={protein} onChange={edit(setProtein)} />
          <MacroField label="grassi" value={fat} onChange={edit(setFat)} />
        </div>

        <PortionPicker value={portion} onChange={choosePortion} disabled={busy} />

        <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: 0 }}>
          Se cambi i numeri, questa voce diventa &quot;corretta da te&quot; e smetto di ritoccarla. La porzione
          li ricalcola e basta.
        </p>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="tap-target"
            style={{ background: "var(--sabbia-chip)", color: "var(--rosso-avviso)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
          >
            Elimina
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="tap-target"
            style={{ flex: 1, background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: busy ? "default" : "pointer" }}
          >
            Salva
          </button>
        </div>
      </div>
    </div>
  );
}
