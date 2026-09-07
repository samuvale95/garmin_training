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

/** Screen E1 -- correcting (or deleting) one logged meal. Every save marks the entry
 * `corrected`, which is what tells the rest of the app (and any future estimate) to
 * stop touching it -- see EntryPatchRequest's docstring in schemas.py. */
export function FuelCorrectionSheet({ entry, onClose }: { entry: FoodEntry; onClose: () => void }) {
  const { reduced } = useMotionEnabled();
  const updateEntry = useUpdateEntry();
  const deleteEntry = useDeleteEntry();
  const [description, setDescription] = useState(entry.description ?? "");
  const [carb, setCarb] = useState(entry.carb_g != null ? String(Math.round(entry.carb_g)) : "");
  const [protein, setProtein] = useState(entry.protein_g != null ? String(Math.round(entry.protein_g)) : "");
  const [fat, setFat] = useState(entry.fat_g != null ? String(Math.round(entry.fat_g)) : "");

  const busy = updateEntry.isPending || deleteEntry.isPending;

  function save() {
    updateEntry.mutate(
      {
        id: entry.id,
        description: description.trim() || null,
        carb_g: carb === "" ? null : Number(carb),
        protein_g: protein === "" ? null : Number(protein),
        fat_g: fat === "" ? null : Number(fat),
      },
      { onSuccess: onClose }
    );
  }

  function remove() {
    deleteEntry.mutate(entry.id, { onSuccess: onClose });
  }

  const sheetStyle: CSSProperties = {
    width: "100%",
    background: "var(--crema)",
    borderRadius: "22px 22px 0 0",
    padding: "10px 20px 28px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(28,26,22,.4)", display: "flex", alignItems: "flex-end", zIndex: 30 }} onClick={onClose}>
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
          <MacroField label="carbo" value={carb} onChange={setCarb} />
          <MacroField label="proteine" value={protein} onChange={setProtein} />
          <MacroField label="grassi" value={fat} onChange={setFat} />
        </div>

        <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: 0 }}>
          Salvando, questa voce diventa &quot;corretta da te&quot; e smetto di ritoccarla.
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
