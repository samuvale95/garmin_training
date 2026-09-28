"use client";

import { useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { PlanWaiting } from "@/components/PlanWaiting";
import { ApiError } from "@/lib/apiClient";
import { formatFullDate } from "@/lib/format";
import { generationWindow, useGeneratePlan, useGenerationState } from "@/lib/queries";
import type { GeneratePlanResult } from "@/lib/types";

const card: React.CSSProperties = {
  background: "var(--crema-card)",
  borderRadius: "var(--radius-card)",
  padding: 14,
  marginTop: 12,
};

const pill = (primary: boolean): React.CSSProperties => ({
  background: primary ? "var(--inchiostro)" : "var(--sabbia-chip)",
  color: primary ? "var(--crema)" : "var(--inchiostro-70)",
  border: "none",
  borderRadius: "var(--radius-pill)",
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
});

/** "Genera le prossime settimane" on Settimana: the server writes the window inside the
 * code's limits (see `training_plan/plan_generator.py`), sessions edited by hand stay.
 * Its state lives in the mutation cache (`useGenerationState`), not here. */
export function PlanGenerateCard({ animate, delayMs = 0 }: { animate: boolean; delayMs?: number }) {
  const generate = useGeneratePlan();
  const generation = useGenerationState();
  const [confirming, setConfirming] = useState(false);

  if (generation.status === "pending") {
    return (
      <div style={{ ...card, padding: "18px 14px 14px" }}>
        <PlanWaiting startedAt={generation.startedAt} />
      </div>
    );
  }

  if (generation.result) {
    return <GenerateSummary result={generation.result} onClose={generation.dismiss} />;
  }

  if (generation.error) {
    const error = generation.error;
    const details = error instanceof ApiError ? error.details : [];
    return (
      <div style={card} role="alert">
        <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>
          {error instanceof ApiError && error.message ? error.message : "Non sono riuscito a scrivere il piano."}
        </p>
        {details.length > 0 && (
          <ul style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "8px 0 0", paddingLeft: 18 }}>
            {details.slice(0, 4).map((detail) => (
              <li key={detail}>{detail}</li>
            ))}
          </ul>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button type="button" className="press-soft" style={pill(false)} onClick={generation.dismiss}>
            Chiudi
          </button>
        </div>
      </div>
    );
  }

  if (confirming) {
    const { start, end } = generationWindow();
    return (
      <div style={card}>
        <p style={{ fontSize: 14, margin: 0, lineHeight: 1.45 }}>
          Scrivo le sedute da {formatFullDate(start)} a {formatFullDate(end)}, dentro i limiti del tuo livello. Sostituisce
          le sedute di quei giorni; quelle che hai modificato a mano restano come sono.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="press-soft"
            style={pill(true)}
            onClick={() => {
              setConfirming(false);
              generate.mutate(false);
            }}
          >
            Genera
          </button>
          <button type="button" className="press-soft" style={pill(false)} onClick={() => setConfirming(false)}>
            Annulla
          </button>
        </div>
      </div>
    );
  }

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
      <p className="font-serif-italic" style={{ fontSize: 14, margin: 0, flex: 1 }}>
        Fatti scrivere le prossime settimane dai tuoi dati.
      </p>
      <button type="button" className="press-soft" style={pill(true)} onClick={() => setConfirming(true)}>
        Genera
      </button>
    </SlideUp>
  );
}

function GenerateSummary({ result, onClose }: { result: GeneratePlanResult; onClose: () => void }) {
  const source =
    result.source === "ai"
      ? "Scritto dall'AI e controllato sui tuoi limiti."
      : `Scritto con le regole di base${result.fallback_reason ? ` (${result.fallback_reason})` : ""}.`;
  return (
    <div style={card} role="status">
      <p style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>
        {result.written.length} sedute dal {formatFullDate(result.start)} al {formatFullDate(result.end)}.
      </p>
      <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>{source}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
        {result.weeks.map((week) => (
          <li key={week.skeleton.monday} style={{ fontSize: 13, lineHeight: 1.45, color: "var(--inchiostro-70)" }}>
            <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)" }}>
              {week.target_minutes}&apos; · {formatFullDate(week.first_day)}
            </span>
            <br />
            {week.reason}
          </li>
        ))}
      </ul>
      {result.conflicts.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--rosso-avviso)", margin: "10px 0 0" }}>
          Non ho toccato {result.conflicts.map((c) => `${c.title} (${formatFullDate(c.date)})`).join(", ")}: in quei
          giorni c&apos;è una seduta che hai modificato tu.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" className="press-soft" style={pill(false)} onClick={onClose}>
          Chiudi
        </button>
      </div>
    </div>
  );
}
