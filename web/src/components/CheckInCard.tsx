"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { SlideUp } from "@/components/motion/primitives";
import { ShoeIcon } from "@/components/Icons";
import { useCheckAdaptation, useSaveCheckIn, useShoes } from "@/lib/queries";
import type { CheckIn, CheckInBody, CheckInEffort, PainArea } from "@/lib/types";

const EFFORTS: [CheckInEffort, string][] = [
  ["facile", "Facile"],
  ["giusta", "Giusta"],
  ["dura", "Dura"],
  ["troppo", "Troppo"],
];
const BODIES: [CheckInBody, string][] = [
  ["bene", "Bene"],
  ["stanco", "Stanco"],
  ["dolore", "Dolore"],
];
const AREAS: [PainArea, string][] = [
  ["piede", "Piede"],
  ["caviglia", "Caviglia"],
  ["polpaccio", "Polpaccio"],
  ["stinco", "Stinco"],
  ["ginocchio", "Ginocchio"],
  ["coscia", "Coscia"],
  ["anca", "Anca"],
  ["schiena", "Schiena"],
  ["altro", "Altro"],
];

const LABELS: Record<string, string> = Object.fromEntries([...EFFORTS, ...BODIES, ...AREAS]);

/** The 10-second check-in on Oggi (see `training_plan/checkin.py`): how the session felt,
 * how the body is, and where it hurts if it does. Saved the moment the answer is
 * complete -- a "Salva" button would be a third tap for nothing. */
export function CheckInCard({
  date,
  dayLabel,
  trained,
  existing,
  animate,
  delayMs = 0,
}: {
  date: string;
  /** "oggi" or "ieri": which day is being asked about. */
  dayLabel: "oggi" | "ieri";
  trained: boolean;
  existing: CheckIn | null;
  animate: boolean;
  delayMs?: number;
}) {
  const save = useSaveCheckIn();
  const shoesQuery = useShoes();
  const activeShoes = shoesQuery.data?.shoes.filter((s) => !s.retired) ?? [];
  const primaryShoe = activeShoes[0] ?? null;

  // What was just said may be a reason to adapt the plan (pain, a session too hard).
  const checkAdaptation = useCheckAdaptation();
  const [editing, setEditing] = useState(false);
  const [effort, setEffort] = useState<CheckInEffort | null>(existing?.effort ?? null);
  const [body, setBody] = useState<CheckInBody | null>(existing?.body ?? null);
  const [area, setArea] = useState<PainArea | null>(existing?.pain_area ?? null);

  function submit(next: { effort: CheckInEffort | null; body: CheckInBody | null; area: PainArea | null }) {
    if (trained && !next.effort) return;
    if (!next.body) return;
    if (next.body === "dolore" && !next.area) return;
    save.mutate(
      { date, effort: trained ? next.effort : null, body: next.body, pain_area: next.body === "dolore" ? next.area : null },
      {
        onSuccess: () => {
          setEditing(false);
          checkAdaptation(true);
        },
      }
    );
  }

  if (existing && !editing) {
    const parts = [existing.effort && `seduta ${LABELS[existing.effort].toLowerCase()}`, LABELS[existing.body].toLowerCase()];
    if (existing.pain_area) parts.push(LABELS[existing.pain_area].toLowerCase());
    return (
      <SlideUp active={animate} delayMs={delayMs} style={{ ...cardStyle, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%" }}>
          <p style={{ fontSize: 13, margin: 0, flex: 1, color: "var(--inchiostro-70)" }}>
            <span style={{ fontWeight: 600, color: "var(--inchiostro)" }}>Check-in {dayLabel}:</span> {parts.filter(Boolean).join(" · ")}
          </p>
          <motion.button
            type="button"
            whileTap={{ scale: 0.92 }}
            whileHover={{ scale: 1.05 }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            style={linkButton}
            onClick={() => setEditing(true)}
          >
            Cambia
          </motion.button>
        </div>

        {primaryShoe && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--border-airbnb)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <ShoeIcon size={14} strokeWidth={2} style={{ color: "var(--inchiostro-50)" }} />
              <span style={{ fontSize: 12, color: "var(--inchiostro-70)", fontWeight: 500 }}>
                {primaryShoe.name}
              </span>
              <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
                ({Math.round(primaryShoe.distance_km)} km)
              </span>
            </div>
            <Link
              href="/shoes?from=/today"
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--inchiostro-70)",
                textDecoration: "none",
                background: "var(--sabbia-chip)",
                padding: "3px 8px",
                borderRadius: "var(--radius-pill)",
              }}
            >
              Scarpe →
            </Link>
          </div>
        )}
      </SlideUp>
    );
  }

  return (
    <SlideUp active={animate} delayMs={delayMs} style={cardStyle}>
      <p style={{ font: "600 16px/1.2 var(--font-sans)", margin: 0 }}>
        {dayLabel === "oggi" ? "Com'è andata oggi?" : "Com'è andata ieri?"}
      </p>
      <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "3px 0 0" }}>
        Due risposte: servono a capire come stai oltre a quello che misura l&apos;orologio.
      </p>

      {trained && (
        <ChipRow
          label="La seduta"
          options={EFFORTS}
          value={effort}
          onChange={(value) => {
            setEffort(value);
            submit({ effort: value, body, area });
          }}
        />
      )}
      <ChipRow
        label="Il corpo"
        options={BODIES}
        value={body}
        onChange={(value) => {
          setBody(value);
          if (value !== "dolore") setArea(null);
          submit({ effort, body: value, area: value === "dolore" ? area : null });
        }}
      />
      {body === "dolore" && (
        <ChipRow
          label="Dove?"
          options={AREAS}
          value={area}
          onChange={(value) => {
            setArea(value);
            submit({ effort, body, area: value });
          }}
        />
      )}
      {save.isError && (
        <p role="alert" style={{ fontSize: 12.5, color: "var(--rosso-avviso)", margin: "10px 0 0" }}>
          Non sono riuscito a salvare. Riprova.
        </p>
      )}
    </SlideUp>
  );
}

function ChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <p style={{ font: "500 11.5px var(--font-sans)", color: "var(--inchiostro-50)", margin: "0 0 6px" }}>{label}</p>
      <div role="radiogroup" aria-label={label} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {options.map(([key, text]) => {
          const selected = value === key;
          return (
            <motion.button
              key={key}
              type="button"
              role="radio"
              aria-checked={selected}
              whileTap={{ scale: 0.93 }}
              whileHover={{ scale: 1.05, y: -1 }}
              transition={{ type: "spring", stiffness: 450, damping: 25 }}
              onClick={() => onChange(key)}
              style={{
                background: selected ? "var(--inchiostro)" : "var(--sabbia-chip)",
                color: selected ? "var(--crema)" : "var(--inchiostro-70)",
                border: "none",
                borderRadius: "var(--radius-pill)",
                padding: "7px 13px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: selected ? "0 2px 8px rgba(28,26,22,0.18)" : "none",
              }}
            >
              {text}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--crema)",
  border: "var(--border-airbnb)",
  boxShadow: "var(--shadow-airbnb-subtle)",
  borderRadius: "var(--radius-card)",
  padding: 16,
  marginTop: 12,
};

const linkButton: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "4px 2px",
  fontSize: 12.5,
  fontWeight: 600,
  color: "var(--inchiostro-70)",
  cursor: "pointer",
  textDecoration: "underline",
};
