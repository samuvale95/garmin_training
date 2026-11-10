"use client";

import { useState } from "react";
import { useCreateManualActivity } from "@/lib/queries";
import { toDateKey } from "@/lib/sessionVisuals";
import { CloseIcon } from "@/components/Icons";

const SPORTS = [
  { id: "soccer", label: "Calcetto / Calcio", icon: "⚽" },
  { id: "beach_volleyball", label: "Beach Volley", icon: "🏐" },
  { id: "tennis", label: "Padel / Tennis", icon: "🎾" },
  { id: "strength_training", label: "Palestra / Pesi", icon: "🏋️" },
  { id: "calisthenics", label: "Calisthenics", icon: "🤸" },
  { id: "swimming", label: "Nuoto", icon: "🏊" },
  { id: "running", label: "Corsa libera", icon: "🏃" },
  { id: "cycling", label: "Bici", icon: "🚴" },
  { id: "other", label: "Altro sport", icon: "🎯" },
];

const QUICK_MINUTES = [30, 45, 60, 90, 120];

interface ManualActivityModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultDate?: string;
}

export function ManualActivityModal({ isOpen, onClose, defaultDate }: ManualActivityModalProps) {
  const createMutation = useCreateManualActivity();
  const [sport, setSport] = useState("soccer");
  const [day, setDay] = useState(() => defaultDate || toDateKey(new Date()));
  const [durationMin, setDurationMin] = useState(60);
  const [title, setTitle] = useState("");
  const [rpe, setRpe] = useState(7);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!durationMin || durationMin <= 0) {
      setError("Inserisci una durata valida in minuti.");
      return;
    }

    const currentSport = SPORTS.find((s) => s.id === sport);
    const finalTitle = title.trim() || `${currentSport?.icon ?? "🏅"} ${currentSport?.label ?? "Attività"}`;

    try {
      await createMutation.mutateAsync({
        day,
        sport,
        title: finalTitle,
        duration_min: Number(durationMin),
        rpe,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore durante il salvataggio.");
    }
  }

  const rpeDescription =
    rpe <= 3 ? "Leggero (attivazione blanda)" : rpe <= 6 ? "Moderato (impegno costante)" : rpe <= 8 ? "Intenso / Duro (scatti, fatica)" : "Massimale / Devastante (fino all'ultima goccia)";

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="card"
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          overflowY: "auto",
          background: "var(--sfondo, #FAF7F2)",
          padding: 24,
          borderRadius: 16,
          boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
          position: "relative",
        }}
      >
        <button
          type="button"
          onClick={onClose}
          style={{
            position: "absolute",
            top: 16,
            right: 16,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: "var(--inchiostro-70)",
          }}
          aria-label="Chiudi"
        >
          <CloseIcon aria-hidden="true" />
        </button>

        <h3 style={{ margin: "0 0 6px", fontSize: 18, fontWeight: 700, color: "var(--inchiostro)" }}>
          Registra attività senza orologio
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 13, color: "var(--inchiostro-70)", lineHeight: 1.4 }}>
          Hai giocato a calcetto, beach volley o fatto un allenamento senza smartwatch? Inseriscilo per dare contesto reale all&apos;app e all&apos;AI Coach sul tuo affaticamento.
        </p>

        {error && (
          <div style={{ background: "rgba(232, 93, 78, 0.15)", color: "var(--corallo-testo)", padding: "8px 12px", borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-70)", marginBottom: 6 }}>
              Sport
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {SPORTS.map((s) => {
                const active = sport === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSport(s.id)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 10px",
                      borderRadius: 8,
                      border: active ? "1.5px solid var(--inchiostro)" : "1px solid var(--sabbia-bordo, #DDD)",
                      background: active ? "var(--inchiostro)" : "var(--crema, #FFF)",
                      color: active ? "var(--crema, #FFF)" : "var(--inchiostro)",
                      fontSize: 12,
                      fontWeight: active ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <span>{s.icon}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-70)", marginBottom: 4 }}>
                Giorno
              </label>
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--sabbia-bordo, #DDD)", background: "var(--crema, #FFF)", fontSize: 14 }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-70)", marginBottom: 4 }}>
                Durata (min)
              </label>
              <input
                type="number"
                min={5}
                max={600}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--sabbia-bordo, #DDD)", background: "var(--crema, #FFF)", fontSize: 14 }}
              />
            </div>
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: -6 }}>
            {QUICK_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setDurationMin(m)}
                style={{
                  padding: "3px 8px",
                  borderRadius: "var(--radius-pill, 999px)",
                  border: durationMin === m ? "1px solid var(--inchiostro)" : "1px solid var(--sabbia-bordo, #DDD)",
                  background: durationMin === m ? "var(--sabbia, #EAE6DE)" : "transparent",
                  fontSize: 11,
                  fontWeight: durationMin === m ? 700 : 500,
                  cursor: "pointer",
                }}
              >
                {m} min
              </button>
            ))}
          </div>

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <label style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-70)" }}>
                Sforzo percepito (RPE: {rpe}/10)
              </label>
              <span style={{ fontSize: 11, color: "var(--corallo-testo)", fontWeight: 600 }}>{rpeDescription}</span>
            </div>
            <input
              type="range"
              min={1}
              max={10}
              value={rpe}
              onChange={(e) => setRpe(Number(e.target.value))}
              style={{ width: "100%", cursor: "pointer", accentColor: "var(--corallo)" }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-70)", marginBottom: 4 }}>
              Titolo / Descrizione (opzionale)
            </label>
            <input
              type="text"
              placeholder="Es: Partita 5vs5 al campo sintetico"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--sabbia-bordo, #DDD)", background: "var(--crema, #FFF)", fontSize: 14 }}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--inchiostro-70)", marginBottom: 4 }}>
              Note per il Coach (opzionale)
            </label>
            <textarea
              placeholder="Es: Gambe pesanti, sabbia profonda, tanti scatti ed eccentrici..."
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--sabbia-bordo, #DDD)", background: "var(--crema, #FFF)", fontSize: 13, resize: "none" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              type="submit"
              className="btn"
              data-variant="primary"
              disabled={createMutation.isPending}
              style={{ flex: 1, padding: "10px", fontWeight: 700 }}
            >
              {createMutation.isPending ? "Salvataggio..." : "Salva nel calendario"}
            </button>
            <button
              type="button"
              className="btn"
              data-variant="secondary"
              onClick={onClose}
              disabled={createMutation.isPending}
              style={{ padding: "10px 16px" }}
            >
              Annulla
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
