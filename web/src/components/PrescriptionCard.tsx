"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { SlideUp } from "@/components/motion/primitives";
import { formatPaceRange, stepGroupLine } from "@/lib/format";
import { groupSteps } from "@/lib/format";
import { useAddSession } from "@/lib/queries";
import type { Prescription, SensitivityRow } from "@/lib/types";

// One prescribed session: what is wrong, what this changes, and a button that puts it in
// the plan.
//
// The button is the whole point of the screen. Everything before it in this app stops at
// a finding, and a finding the athlete has to translate into a workout themselves is a
// finding most people will not act on.

const EVIDENCE_LABEL: Record<Prescription["evidence"], string> = {
  misurato: "misurato",
  ricerca: "ricerca",
  "tuoi dati": "tuoi dati",
};

export function PrescriptionCard({
  prescription,
  animate,
  delayMs,
}: {
  prescription: Prescription;
  animate: boolean;
  delayMs: number;
}) {
  const router = useRouter();
  const addSession = useAddSession();
  const [added, setAdded] = useState(false);

  const groups = groupSteps(prescription.session.steps);

  function add() {
    addSession(prescription.session);
    setAdded(true);
  }

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 12 }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <p style={{ font: "600 19px/1.2 var(--font-outfit)", letterSpacing: "-.02em", margin: 0 }}>
          {prescription.title}
        </p>
        <span
          style={{
            background: "var(--azzurro)",
            color: "var(--azzurro-testo)",
            borderRadius: "var(--radius-pill)",
            padding: "3px 10px",
            fontSize: 10,
            fontWeight: 700,
            flex: "none",
          }}
        >
          {EVIDENCE_LABEL[prescription.evidence]}
        </span>
      </div>

      <p style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "10px 0 0", lineHeight: 1.45 }}>
        {prescription.rationale}
      </p>

      {/* The session itself, spelled out in the same row format the plan uses, so it
          reads identically here and after it has been added. */}
      <div style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 15, marginTop: 14 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
          <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>{prescription.session.title}</p>
          {prescription.heart_rate_cap && (
            <span className="font-mono" style={{ fontSize: 11.5, color: "var(--rosso-testo)", fontWeight: 700, flex: "none" }}>
              max {prescription.heart_rate_cap} bpm
            </span>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10 }}>
          {groups.map((group, i) => (
            <p key={i} className="font-mono" style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: 0 }}>
              {stepGroupLine(group)}
            </p>
          ))}
        </div>

        {prescription.session.description && (
          <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "11px 0 0", lineHeight: 1.4 }}>
            {prescription.session.description}
          </p>
        )}
      </div>

      <p style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: "12px 0 0", lineHeight: 1.45 }}>
        <span style={{ fontWeight: 600, color: "var(--inchiostro-70)" }}>Cosa aspettarsi: </span>
        {prescription.expected}
      </p>

      {added ? (
        <button
          type="button"
          onClick={() => router.push("/week")}
          className="press-soft"
          style={{ width: "100%", background: "var(--verde)", color: "var(--verde-testo)", border: "none", borderRadius: "var(--radius-pill)", padding: "14px 22px", marginTop: 16, fontSize: 14.5, fontWeight: 600, cursor: "pointer" }}
        >
          Aggiunta al piano · vedi in Settimana
        </button>
      ) : (
        <button
          type="button"
          onClick={add}
          className="press-soft"
          style={{ width: "100%", background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "15px 22px", marginTop: 16, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
        >
          Aggiungi al piano
        </button>
      )}
    </SlideUp>
  );
}

/** How much the verdict moves if the threshold estimate is wrong.
 *
 * On screen rather than in a footnote because the entire diagnosis pivots on one number
 * Garmin estimated. A table that shows the verdict surviving -- or not -- across the
 * plausible range is the difference between a finding and a claim. */
export function SensitivityTable({ rows, animate, delayMs }: { rows: SensitivityRow[]; animate: boolean; delayMs: number }) {
  if (rows.length === 0) return null;
  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 14 }}>
      <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
        e se la soglia fosse diversa
      </p>

      <div style={{ overflowX: "auto", marginTop: 12 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr style={{ color: "var(--inchiostro-50)" }}>
              <th style={{ textAlign: "left", fontWeight: 600, padding: "0 8px 7px 0" }}>soglia</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 8px 7px 0" }}>facile</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 8px 7px 0" }}>intermedia</th>
              <th style={{ textAlign: "right", fontWeight: 600, padding: "0 0 7px 0" }}>dura</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map((row) => (
              <tr key={row.threshold_hr} style={{ fontWeight: row.is_estimate ? 700 : 400 }}>
                <td style={{ padding: "5px 8px 5px 0", whiteSpace: "nowrap" }}>
                  {row.threshold_hr} bpm{row.is_estimate ? " ·" : ""}
                </td>
                <td style={{ textAlign: "right", padding: "5px 8px 5px 0" }}>{Math.round(row.easy_share * 100)}%</td>
                <td style={{ textAlign: "right", padding: "5px 8px 5px 0" }}>{Math.round(row.grey_share * 100)}%</td>
                <td style={{ textAlign: "right", padding: "5px 0" }}>{Math.round(row.hard_share * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11.5, color: "var(--inchiostro-35)", margin: "12px 0 0", lineHeight: 1.45 }}>
        La riga in grassetto è la stima di Garmin. Tutto quello che c&apos;è sopra dipende da quel
        numero, quindi prima di riscrivere un blocco di allenamento su questi dati vale la pena
        confermarlo con un test sul campo.
      </p>
    </SlideUp>
  );
}

/** The paces the prescriptions are written in, with what backs each. */
export function PaceProfileCard({
  easy,
  threshold,
  animate,
  delayMs,
}: {
  easy: { sec_per_km: number; slower_sec_per_km: number; faster_sec_per_km: number; samples: number; heart_rate: number } | null;
  threshold: { sec_per_km: number; slower_sec_per_km: number; faster_sec_per_km: number; samples: number; heart_rate: number } | null;
  animate: boolean;
  delayMs: number;
}) {
  if (!easy && !threshold) return null;
  const rows = [
    { label: "a soglia aerobica", estimate: easy },
    { label: "a soglia", estimate: threshold },
  ].filter((r) => r.estimate);

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
      <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
        i tuoi passi, misurati
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {rows.map(({ label, estimate }) => (
          <div key={label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 13.5, color: "var(--inchiostro-70)" }}>
              {label} ({estimate!.heart_rate} bpm)
            </span>
            <span className="font-mono" style={{ fontSize: 15, fontWeight: 600, flex: "none" }}>
              {formatPaceRange({ slower_sec_per_km: estimate!.slower_sec_per_km, faster_sec_per_km: estimate!.faster_sec_per_km })}
            </span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11.5, color: "var(--inchiostro-35)", margin: "12px 0 0", lineHeight: 1.45 }}>
        Non una tabella: la mediana del passo che tieni davvero a quella frequenza, su{" "}
        {(easy?.samples ?? 0) + (threshold?.samples ?? 0)} campioni del tuo storico.
      </p>
    </SlideUp>
  );
}
