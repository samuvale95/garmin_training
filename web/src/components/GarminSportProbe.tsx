"use client";

import { useState } from "react";
import { apiGet } from "@/lib/apiClient";
import { dis } from "@/lib/disabled";

interface SportType { sportTypeId?: number; sportTypeKey?: string }
interface ProbeResult {
  types?: { workoutSportTypes?: SportType[] } & Record<string, unknown>;
  types_error?: string;
  saved_workout_sports?: { sportType: SportType; count: number }[];
  saved_workouts_error?: string;
}

/** Admin only. Reads, without creating anything, the sport codes Garmin uses for
 * workouts on this account -- needed before adding trail, bodyweight, bike and swim
 * workouts. The full answer also goes to the server log. */
export function GarminSportProbe() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [result, setResult] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (state === "busy") return;
    setState("busy");
    setError(null);
    try {
      setResult(await apiGet<ProbeResult>("/garmin/probe/workout-types"));
      setState("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Errore sconosciuto");
      setState("error");
    }
  }

  const sports = result?.types?.workoutSportTypes ?? [];
  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>Sport degli allenamenti su Garmin</p>
      <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "2px 0 10px" }}>
        Legge i codici che Garmin usa per ogni sport. Non crea e non modifica niente.
      </p>
      <button type="button" className="ux-button" data-track="settings.garmin-probe" onClick={run} {...dis(state === "busy", "in_caricamento")}>
        {state === "busy" ? "Leggo da Garmin…" : state === "done" ? "Leggi di nuovo" : "Leggi da Garmin"}
      </button>
      {error && <p role="alert" className="ux-error">{error}</p>}
      {result && (
        <div style={{ fontSize: 12.5, marginTop: 10, color: "var(--inchiostro-70)" }}>
          {result.types_error && <p role="alert">Tipi: {result.types_error}</p>}
          {sports.length > 0 && <p>Tipi di allenamento: {sports.map((s) => `${s.sportTypeKey} (${s.sportTypeId})`).join(", ")}</p>}
          {result.saved_workout_sports && (
            <p>Nei tuoi allenamenti salvati: {result.saved_workout_sports.map((s) => `${s.sportType.sportTypeKey} (${s.sportType.sportTypeId}) ×${s.count}`).join(", ") || "nessuno"}</p>
          )}
          <p style={{ color: "var(--inchiostro-50)" }}>Il risultato completo è nei log del server: posso leggerlo da lì.</p>
        </div>
      )}
    </div>
  );
}
