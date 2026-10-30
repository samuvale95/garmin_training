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

const AVAILABLE_SPORTS = [
  { id: "running", label: "Corsa" },
  { id: "cycling", label: "Bici" },
  { id: "calisthenics", label: "Calisthenics (Parco)" },
  { id: "strength_training", label: "Potenziamento / Forza" },
  { id: "swimming", label: "Nuoto" },
];

/** "Genera le prossime settimane" on Settimana: the server writes the window inside the
 * code's limits (see `training_plan/plan_generator.py`), sessions edited by hand stay.
 * Its state lives in the mutation cache (`useGenerationState`), not here. */
export function PlanGenerateCard({ animate, delayMs = 0, planId }: { animate: boolean; delayMs?: number; planId?: string }) {
  const generate = useGeneratePlan();
  const generation = useGenerationState();
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState<"rebuild" | "augment" | "adapt_current">("rebuild");
  const [sports, setSports] = useState<string[]>(["running"]);
  const [userPrompt, setUserPrompt] = useState("");

  const toggleSport = (sportId: string) => {
    if (sports.includes(sportId)) {
      if (sports.length > 1) {
        setSports(sports.filter((s) => s !== sportId));
      }
    } else {
      setSports([...sports, sportId]);
    }
  };

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
          <button data-track="plan-generate-card.generation-dismiss" type="button" className="press-soft" style={pill(false)} onClick={generation.dismiss}>
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
        <p style={{ fontSize: 14, margin: 0, fontWeight: 600, lineHeight: 1.45 }}>
          Genera o adatta allenamenti con AI ({formatFullDate(start)} – {formatFullDate(end)})
        </p>
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "4px 0 12px", lineHeight: 1.4 }}>
          L&apos;AI calcolerà le sedute rispettando la cronologia reale dei tuoi carichi e il piano attivo.
        </p>

        {/* Modalità */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro-70)", display: "block", marginBottom: 6 }}>
            Modalità di generazione
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { id: "rebuild", label: "Ricostruisci finestra" },
              { id: "augment", label: "Integra sport / cross-training" },
              { id: "adapt_current", label: "Adatta al carico attuale" },
            ].map((m) => {
              const active = mode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id as "rebuild" | "augment" | "adapt_current")}
                  style={{
                    fontSize: 12,
                    padding: "5px 10px",
                    borderRadius: "var(--radius-pill)",
                    border: active ? "1.5px solid var(--inchiostro)" : "1px solid var(--sabbia-chip)",
                    background: active ? "var(--inchiostro)" : "var(--crema)",
                    color: active ? "var(--crema)" : "var(--inchiostro)",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Sport coinvolti */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro-70)", display: "block", marginBottom: 6 }}>
            Discipline coinvolte
          </label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {AVAILABLE_SPORTS.map((sp) => {
              const active = sports.includes(sp.id);
              return (
                <button
                  key={sp.id}
                  type="button"
                  onClick={() => toggleSport(sp.id)}
                  style={{
                    fontSize: 12,
                    padding: "4px 10px",
                    borderRadius: "var(--radius-pill)",
                    border: active ? "1px solid var(--inchiostro)" : "1px dashed var(--sabbia-chip)",
                    background: active ? "var(--sabbia-chip)" : "transparent",
                    color: "var(--inchiostro)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <span>{active ? "✓" : "+"}</span>
                  {sp.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Note / Preferenze utente */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro-70)", display: "block", marginBottom: 6 }}>
            Istruzioni o preferenze specifiche (opzionale)
          </label>
          <textarea
            value={userPrompt}
            onChange={(e) => setUserPrompt(e.target.value)}
            placeholder="Es: vorrei fare nuoto leggero mercoledì e palestra il venerdì; mantieni la corsa lunga la domenica."
            rows={2}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--sabbia-chip)",
              background: "var(--crema)",
              fontSize: 12.5,
              color: "var(--inchiostro)",
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            data-track="plan-generate-card.button"
            type="button"
            className="press-soft"
            style={pill(true)}
            onClick={() => {
              setConfirming(false);
              generate.mutate({
                planId,
                mode,
                sports,
                userPrompt: userPrompt.trim() || null,
              });
            }}
          >
            Genera con AI
          </button>
          <button data-track="plan-generate-card.setconfirming" type="button" className="press-soft" style={pill(false)} onClick={() => setConfirming(false)}>
            Annulla
          </button>
        </div>
      </div>
    );
  }

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ ...card, display: "flex", alignItems: "center", gap: 10 }}>
      <p className="font-serif-italic" style={{ fontSize: 14, margin: 0, flex: 1 }}>
        Genera o adatta allenamenti con l&apos;AI su più sport e in base ai tuoi carichi.
      </p>
      <button data-track="plan-generate-card.setconfirming-2" type="button" className="press-soft" style={pill(true)} onClick={() => setConfirming(true)}>
        Genera con AI
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
            <span className="font-mono" style={{ fontSize: 12.5, color: "var(--inchiostro-50)" }}>
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
        <button data-track="plan-generate-card.onclose" type="button" className="press-soft" style={pill(false)} onClick={onClose}>
          Chiudi
        </button>
      </div>
    </div>
  );
}
