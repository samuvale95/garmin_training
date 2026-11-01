"use client";

import type { ReactNode } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { Explainer, StatusPill } from "@/components/BodyCards";
import { STATUS_STYLE, type SignalStatus } from "@/lib/bodySignals";
import type { GoalBand, PredictionFactor, RacePredictionData } from "@/lib/types";

/** How each band reads at a glance: the same green / amber / coral as Corpo. */
export const BAND_STATUS: Record<GoalBand, SignalStatus> = {
  avanti: "ok",
  in_linea: "ok",
  ambizioso: "attenzione",
  fuori_portata: "allerta",
};

const NEUTRAL = { bg: "var(--sabbia)", text: "var(--inchiostro-70)", stroke: "var(--inchiostro-35)", edge: "rgba(0,0,0,0.08)" };

function severityStatus(severity: PredictionFactor["severity"]): SignalStatus | null {
  return severity === "ok" ? "ok" : severity === "attenzione" ? "attenzione" : null;
}

/** "3:22:05" or, when runs and VO₂max disagree, "3:18:00–3:31:00". */
export function predictedText(p: RacePredictionData): string | null {
  if (p.predicted_low_formatted && p.predicted_high_formatted) return `${p.predicted_low_formatted}–${p.predicted_high_formatted}`;
  return p.predicted_time_formatted ?? null;
}

/** Goal confidence, as the plan wrote it: a band (never a percentage) and the three
 * inputs it comes from, each on its own tile so the one dragging the picture is the
 * one in colour. Everything here is arithmetic from `race_prediction.py`; `narrative`
 * is the only sentence a model may have written, and it falls back to `summary`. */
export function GoalPredictionCard({
  prediction: p,
  narrative,
  animate = true,
  delayMs = 0,
}: {
  prediction: RacePredictionData;
  narrative?: string | null;
  animate?: boolean;
  delayMs?: number;
}) {
  const status = p.band ? BAND_STATUS[p.band] : null;
  const tone = status ? STATUS_STYLE[status] : NEUTRAL;
  const predicted = predictedText(p);
  const slower = p.gap_seconds != null && p.gap_seconds > 0;

  const adh = p.adherence;
  const adhStatus: SignalStatus | null =
    adh.session_pct == null ? null : adh.session_pct >= 85 ? "ok" : adh.session_pct >= 70 ? "attenzione" : "allerta";
  const riskStatus: SignalStatus | null =
    p.risk.level === "basso" ? "ok" : p.risk.level === "moderato" ? "attenzione" : p.risk.level === "alto" ? "allerta" : null;
  const vo2 = p.factors.find((f) => f.key === "vo2max");
  const formStatus: SignalStatus = p.status === "dati_insufficienti" ? "attenzione" : vo2 ? severityStatus(vo2.severity) ?? "ok" : "ok";

  const riskFlags = p.risk.signals.filter((s) => s.severity === "attenzione").length;
  const details = [...p.risk.signals, ...p.factors];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SlideUp
        active={animate}
        delayMs={delayMs}
        style={{
          background: `linear-gradient(160deg, ${tone.bg} 0%, var(--crema-card) 75%)`,
          borderRadius: "var(--radius-card-lg)",
          border: `1.5px solid ${tone.edge}`,
          boxShadow: "var(--shadow-airbnb-subtle)",
          padding: "18px 18px 16px",
        }}
      >
        <p className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: tone.text, margin: 0 }}>
          Confidenza sull&apos;obiettivo{p.weeks_left > 0 ? ` · ${p.weeks_left} settimane` : ""}
        </p>
        <p style={{ fontWeight: 700, fontSize: 22, lineHeight: 1.15, letterSpacing: "-.01em", margin: "5px 0 0" }}>{p.headline}</p>
        {p.band_lowered && (
          <div style={{ marginTop: 8 }}>
            <StatusPill status="attenzione">un gradino in meno per la costanza</StatusPill>
          </div>
        )}

        {predicted && (
          <div style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: "6px 18px", marginTop: 14 }}>
            <div>
              <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: 0 }}>previsto oggi</p>
              <p className="font-mono" style={{ fontSize: predicted.length > 9 ? 22 : 30, fontWeight: 700, letterSpacing: "-.02em", margin: "2px 0 0" }}>{predicted}</p>
            </div>
            {p.target_time_formatted && (
              <div>
                <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: 0 }}>obiettivo</p>
                <p className="font-mono" style={{ fontSize: 18, fontWeight: 600, margin: "2px 0 0", color: "var(--inchiostro-70)" }}>{p.target_time_formatted}</p>
              </div>
            )}
            {p.gap_formatted && status && (
              <span style={{ marginBottom: 3 }}>
                <StatusPill status={status}>{`${p.gap_formatted.replace(/^[+−]/, "")} ${slower ? "sopra" : "sotto"}`}</StatusPill>
              </span>
            )}
          </div>
        )}

        <p style={{ fontSize: 14, lineHeight: 1.4, color: "var(--inchiostro-70)", margin: "12px 0 0" }}>{narrative || p.summary}</p>
        {p.prediction_basis && (
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>
            Stima {p.prediction_basis}
            {p.predicted_pace_formatted ? ` · passo medio ${p.predicted_pace_formatted}` : ""}
          </p>
        )}
      </SlideUp>

      <SlideUp active={animate} delayMs={delayMs + 60}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          <DriverTile status={formStatus} label="Forma" value={!predicted ? "—" : p.predicted_low_formatted ? "intervallo" : (p.predicted_time_formatted ?? "—")}>
            {p.status === "dati_insufficienti" ? "manca un riferimento" : p.predicted_low_formatted ? "corse e VO₂max non concordano" : "dalle corse recenti"}
          </DriverTile>
          <DriverTile status={adhStatus} label="Costanza" value={adh.sessions_planned ? `${adh.sessions_done}/${adh.sessions_planned}` : "—"}>
            {adh.sessions_planned
              ? `sedute in 6 sett.${adh.volume_pct != null ? ` · ${Math.round(adh.km_done)} km su ${Math.round(adh.km_planned ?? 0)}` : ""}`
              : "nessuna seduta in programma"}
          </DriverTile>
          <DriverTile status={riskStatus} label="Rischio" value={p.risk.level === "sconosciuto" ? "—" : p.risk.level}>
            {riskFlags === 0 ? "nessun segnale" : riskFlags === 1 ? "1 segnale" : `${riskFlags} segnali`}
          </DriverTile>
        </div>
      </SlideUp>

      <SlideUp
        active={animate}
        delayMs={delayMs + 120}
        style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", border: "var(--border-airbnb)", boxShadow: "var(--shadow-airbnb-subtle)", padding: "6px 14px" }}
      >
        {details.map((f, i) => {
          const s = severityStatus(f.severity);
          const style = s ? STATUS_STYLE[s] : NEUTRAL;
          return (
            <div key={f.key} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: i ? "1px solid rgba(0,0,0,0.06)" : "none" }}>
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: "50%", background: style.stroke, flex: "none", marginTop: 5 }} />
              <div style={{ minWidth: 0 }}>
                <p style={{ fontSize: 13.5, fontWeight: 600, margin: 0, color: s === "attenzione" ? STATUS_STYLE.attenzione.text : "var(--inchiostro)" }}>{f.label}</p>
                <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "2px 0 0", lineHeight: 1.4 }}>{f.detail}</p>
              </div>
            </div>
          );
        })}
        <div style={{ paddingBottom: 10 }}>
          <Explainer track="goal-prediction.explainer" label="Come lo calcolo">
            Il tempo viene dalla tua corsa recente più veloce (formula di Riegel), confrontata con il VO₂max. Rispetto
            all&apos;obiettivo: fino all&apos;1% più veloce sei avanti, entro il 2% più lento in linea, entro il 6% ambizioso,
            oltre fuori portata. Se nelle ultime 6 settimane hai fatto meno del 70% delle sedute il giudizio scende di un
            gradino. Il rischio guarda il carico degli ultimi 7 giorni rispetto alle 4 settimane, la prontezza degli ultimi
            14 giorni e quanto deve crescere il volume per arrivare alla settimana più carica del piano.
          </Explainer>
        </div>
      </SlideUp>
    </div>
  );
}

function DriverTile({ status, label, value, children }: { status: SignalStatus | null; label: string; value: string; children: ReactNode }) {
  const style = status ? STATUS_STYLE[status] : NEUTRAL;
  const flagged = status === "attenzione" || status === "allerta";
  return (
    <div
      style={{
        minWidth: 0,
        background: flagged ? style.bg : "var(--crema-card)",
        border: flagged ? `1.5px solid ${style.edge}` : "var(--border-airbnb)",
        boxShadow: "var(--shadow-airbnb-subtle)",
        borderRadius: "var(--radius-row)",
        padding: "10px 11px",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600, color: flagged ? style.text : "var(--inchiostro-70)" }}>
        <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: style.stroke }} />
        {label}
      </span>
      <p className="font-mono" style={{ fontSize: 17, fontWeight: 700, margin: "5px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</p>
      <p style={{ fontSize: 12, color: flagged ? style.text : "var(--inchiostro-50)", margin: "3px 0 0", lineHeight: 1.25 }}>{children}</p>
    </div>
  );
}
