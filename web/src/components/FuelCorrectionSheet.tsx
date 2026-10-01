"use client";

import { useState, useRef, useEffect, useMemo, type CSSProperties } from "react";
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

/** Numeric choices for portions, expressed in clean numbers (e.g. 0.5, 0.75, 1.0, 1.25, 1.5, 2.0). */
export const PORTIONS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0] as const;

export function portionLabel(portion: number): string {
  // Clean decimal formatting (e.g. 1, 0.5, 1.25, 1.5, 2)
  return Number.isInteger(portion) ? portion.toFixed(0) : portion.toString().replace(".", ",");
}

export function portionDescriptor(portion: number): string {
  if (portion <= 0.3) return "Assaggio";
  if (portion <= 0.6) return "Mezza porzione";
  if (portion <= 0.85) return "Ridotta";
  if (portion >= 0.95 && portion <= 1.05) return "Porzione intera (1 piatto)";
  if (portion <= 1.35) return "Abbondante";
  if (portion <= 1.65) return "Una e mezza";
  if (portion <= 2.2) return "Doppia";
  return `${portionLabel(portion)} porzioni`;
}

/** A macro field's text at a new portion. Recomputed from the saved entry while the user
 * hasn't typed over it (no rounding drift from repeated taps); once they have, their own
 * number is what gets scaled. */
export function macroAtPortion(saved: number | null, savedPortion: number, typed: string, edited: boolean, from: number, to: number): string {
  if (!edited) return saved != null ? String(Math.round((saved / savedPortion) * to)) : "";
  return typed === "" ? "" : String(Math.round((Number(typed) / from) * to));
}

const ITEM_HEIGHT = 44;
const VISIBLE_ITEMS = 3; // 1 center, 1 above, 1 below

/** iOS Wheel Picker for portions with clean decimal numbers, smooth snapping and tactile styling. */
export function PortionPicker({ value, onChange, disabled }: { value: number; onChange: (portion: number) => void; disabled?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ensure current value is included in list of numbers
  const options = useMemo(() => {
    if (PORTIONS.includes(value as (typeof PORTIONS)[number])) {
      return [...PORTIONS];
    }
    return [...PORTIONS, value].sort((a, b) => a - b);
  }, [value]);

  const selectedIndex = useMemo(() => {
    const idx = options.findIndex((opt) => Math.abs(opt - value) < 0.01);
    return idx >= 0 ? idx : 0;
  }, [options, value]);

  // Center on mount and when value changes externally
  useEffect(() => {
    if (isScrollingRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    const targetScrollTop = selectedIndex * ITEM_HEIGHT;
    if (Math.abs(el.scrollTop - targetScrollTop) > 2) {
      el.scrollTo({ top: targetScrollTop, behavior: "smooth" });
    }
  }, [selectedIndex]);

  const handleScroll = () => {
    if (disabled) return;
    isScrollingRef.current = true;
    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);

    scrollTimeoutRef.current = setTimeout(() => {
      const el = containerRef.current;
      if (!el) return;
      const index = Math.round(el.scrollTop / ITEM_HEIGHT);
      const clampedIndex = Math.max(0, Math.min(options.length - 1, index));
      const targetScroll = clampedIndex * ITEM_HEIGHT;
      el.scrollTo({ top: targetScroll, behavior: "smooth" });

      const chosen = options[clampedIndex];
      if (Math.abs(chosen - value) >= 0.01) {
        onChange(chosen);
      }
      setTimeout(() => {
        isScrollingRef.current = false;
      }, 150);
    }, 80);
  };

  const handleSelectIndex = (idx: number) => {
    if (disabled) return;
    const targetScroll = idx * ITEM_HEIGHT;
    containerRef.current?.scrollTo({ top: targetScroll, behavior: "smooth" });
    onChange(options[idx]);
  };

  return (
    <div
      style={{
        background: "var(--crema-card)",
        borderRadius: "var(--radius-card)",
        padding: "14px 16px",
        border: "1px solid rgba(0,0,0,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--inchiostro-50)" }}>
          Quantità Porzione
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro)" }}>
          {portionDescriptor(value)}
        </span>
      </div>

      {/* iOS Wheel Picker Container */}
      <div
        style={{
          position: "relative",
          height: ITEM_HEIGHT * VISIBLE_ITEMS,
          borderRadius: "var(--radius-chip)",
          background: "var(--crema)",
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.04), 0 2px 8px rgba(0,0,0,0.03)",
          overflow: "hidden",
          border: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        {/* iOS Selection Highlight Band */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: ITEM_HEIGHT,
            left: 8,
            right: 8,
            height: ITEM_HEIGHT,
            background: "rgba(0,0,0,0.035)",
            borderRadius: 10,
            borderTop: "1px solid rgba(0,0,0,0.06)",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
            pointerEvents: "none",
            zIndex: 1,
          }}
        />

        {/* Top Fade Gradient */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: ITEM_HEIGHT,
            background: "linear-gradient(to bottom, var(--crema) 30%, transparent 100%)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />

        {/* Bottom Fade Gradient */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: ITEM_HEIGHT,
            background: "linear-gradient(to top, var(--crema) 30%, transparent 100%)",
            pointerEvents: "none",
            zIndex: 2,
          }}
        />

        {/* Scrollable list */}
        <div
          ref={containerRef}
          onScroll={handleScroll}
          style={{
            height: "100%",
            overflowY: "auto",
            scrollSnapType: "y mandatory",
            paddingTop: ITEM_HEIGHT,
            paddingBottom: ITEM_HEIGHT,
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
          {options.map((option, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <div
                key={option}
                onClick={() => handleSelectIndex(idx)}
                style={{
                  height: ITEM_HEIGHT,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  scrollSnapAlign: "center",
                  cursor: disabled ? "default" : "pointer",
                  transition: "opacity 0.2s ease, transform 0.2s ease",
                  opacity: isSelected ? 1 : 0.35,
                  transform: isSelected ? "scale(1.08)" : "scale(0.92)",
                  userSelect: "none",
                }}
              >
                <span
                  className="font-mono"
                  style={{
                    fontSize: isSelected ? 22 : 18,
                    fontWeight: isSelected ? 800 : 500,
                    color: isSelected ? "var(--inchiostro)" : "var(--inchiostro-50)",
                    letterSpacing: "-0.02em",
                  }}
                >
                  {portionLabel(option)}
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? "var(--inchiostro-70)" : "var(--inchiostro-35)",
                  }}
                >
                  {option === 1 ? "porzione intera" : "porzione"}
                </span>
              </div>
            );
          })}
        </div>
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
