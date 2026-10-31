"use client";

import { useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import type { HrReliability, RaceAnalysis, RaceSection } from "@/lib/types";

const TONE: Record<RaceAnalysis["insights"][number]["tone"], { dot: string; bg: string }> = {
  good: { dot: "var(--verde-tratto-scuro)", bg: "var(--verde-chiaro)" },
  warn: { dot: "var(--giallo-testo)", bg: "var(--giallo)" },
  bad: { dot: "var(--corallo-testo)", bg: "var(--corallo-chiaro)" },
  neutral: { dot: "var(--inchiostro-50)", bg: "var(--sabbia-chip)" },
};

const SPLIT_LABEL: Record<RaceAnalysis["halves"]["kind"], string> = {
  negativo: "Split negativo",
  pari: "Split pari",
  positivo: "Split positivo",
  crollo: "Crollo nel finale",
};

const LEVEL_LABEL: Record<RaceAnalysis["level"], string> = {
  1: "Lettura essenziale",
  2: "Lettura strutturata",
  3: "Lettura da atleta",
};

const eyebrow = {
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase" as const,
  color: "var(--inchiostro-50)",
};

const card = {
  background: "var(--crema-card)",
  border: "1px solid var(--border-airbnb)",
  borderRadius: "var(--radius-card)",
  padding: 16,
  marginTop: 12,
};

function signed(seconds: number): string {
  const abs = Math.abs(seconds);
  const txt = abs >= 60 ? `${Math.floor(abs / 60)}'${String(abs % 60).padStart(2, "0")}"` : `${abs}"`;
  return `${seconds < 0 ? "−" : "+"}${txt}`;
}

export function RaceAnalysisCard({
  race,
  reliability,
  animate,
}: {
  race: RaceAnalysis;
  reliability: HrReliability | null | undefined;
  animate: boolean;
}) {
  const [full, setFull] = useState(false);
  const shown = (section: RaceSection) => full || race.visible_sections.includes(section);
  const hiddenCount = (
    ["consistency", "decoupling", "km_splits", "mechanics", "terrain", "patterns"] as RaceSection[]
  ).filter((s) => !race.visible_sections.includes(s)).length;
  const showNote = !!reliability && reliability.verdict !== "affidabile";
  // The note above already says it; the same warning again in the list is noise.
  const insights = showNote ? race.insights.filter((i) => !i.title.startsWith("Battito non affidabile")) : race.insights;
  const lockedFromKm =
    reliability && reliability.verdict === "inaffidabile" ? reliability.unreliable_from_km : null;

  return (
    <SlideUp active={animate} delayMs={160} style={{ marginTop: 16 }}>
      {/* Hero: the result itself, before any analysis */}
      <div
        style={{
          background: "linear-gradient(160deg, var(--verde) 0%, var(--verde-chiaro) 100%)",
          borderRadius: "var(--radius-card-lg)",
          padding: "20px 22px",
          color: "var(--verde-testo)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ ...eyebrow, color: "var(--verde-testo)", opacity: 0.8 }}>
            {race.is_marathon ? "Maratona completata" : "Analisi del lungo"}
          </span>
          <span
            style={{
              fontSize: 10.5,
              fontWeight: 700,
              background: "rgba(255,255,255,0.55)",
              borderRadius: "var(--radius-pill)",
              padding: "3px 10px",
            }}
          >
            {LEVEL_LABEL[race.level]}
          </span>
        </div>
        <div className="font-mono" style={{ fontSize: 44, fontWeight: 700, letterSpacing: "-.03em", marginTop: 6, lineHeight: 1 }}>
          {race.time}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 10, fontSize: 13 }}>
          <span>
            <b className="font-mono">{race.distance_km.toFixed(2)}</b> km
          </span>
          <span>
            <b className="font-mono">{race.avg_pace}</b> medio
          </span>
          <span>
            <b>{SPLIT_LABEL[race.halves.kind]}</b>
          </span>
        </div>
      </div>

      {showNote && reliability && <ReliabilityNote reliability={reliability} />}

      {shown("insights") && insights.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
          {insights.map((insight, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 12,
                background: "var(--crema-card)",
                border: "1px solid var(--border-airbnb)",
                borderRadius: "var(--radius-card)",
                padding: "12px 14px",
              }}
            >
              <span
                aria-hidden
                style={{
                  flex: "0 0 auto",
                  width: 10,
                  height: 10,
                  borderRadius: 999,
                  marginTop: 5,
                  background: TONE[insight.tone].dot,
                  boxShadow: `0 0 0 4px ${TONE[insight.tone].bg}`,
                }}
              />
              <div>
                <div style={{ fontSize: 14, fontWeight: 650, color: "var(--inchiostro)" }}>{insight.title}</div>
                <div style={{ fontSize: 13, lineHeight: 1.45, color: "var(--inchiostro-70)", marginTop: 2 }}>
                  {insight.text}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {shown("halves") && <Halves race={race} />}
      {shown("splits_5k") && race.splits_5k.length > 1 && <SplitChart race={race} lockedFromKm={lockedFromKm} />}
      {shown("decoupling") && <Decoupling race={race} />}
      {shown("km_splits") && race.km_splits.length > 0 && <KmTable race={race} lockedFromKm={lockedFromKm} />}
      {(shown("mechanics") || shown("terrain") || shown("patterns")) && <Technical race={race} shown={shown} />}

      {hiddenCount > 0 && (
        <button
          type="button"
          data-track="analisi_gara.completa"
          onClick={() => setFull((f) => !f)}
          className="press-soft"
          style={{
            width: "100%",
            marginTop: 12,
            background: "transparent",
            border: "1px dashed var(--sabbia-bordo)",
            borderRadius: "var(--radius-card)",
            padding: "12px 16px",
            fontSize: 13,
            fontWeight: 650,
            color: "var(--accent)",
            cursor: "pointer",
          }}
        >
          {full ? "Torna alla lettura essenziale" : "Mostra l'analisi completa"}
        </button>
      )}
    </SlideUp>
  );
}

function ReliabilityNote({ reliability }: { reliability: HrReliability }) {
  const step = reliability.steps[0];
  const source =
    reliability.hr_source === "chest_strap" ? "fascia cardio" : reliability.hr_source === "wrist" ? "polso" : null;
  return (
    <div
      role="note"
      style={{
        ...card,
        background: "var(--lilla)",
        border: "none",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span aria-hidden style={{ fontSize: 20, lineHeight: 1 }}>
        ♡
      </span>
      <div>
        <div style={{ fontSize: 14, fontWeight: 650, color: "var(--lilla-testo)" }}>
          {reliability.verdict === "inaffidabile"
            ? `Battito non affidabile${reliability.unreliable_from_km != null ? ` dal km ${Math.round(reliability.unreliable_from_km)}` : ""}`
            : "Battito da prendere con cautela"}
        </div>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "var(--inchiostro-70)", marginTop: 3 }}>
          {reliability.reasons[0] ?? "Il segnale del sensore è irregolare."}
          {step && reliability.verdict === "inaffidabile" && " I battiti di quel tratto sono esclusi dall'analisi."}
          {source && ` Sensore: ${source}.`}
        </div>
      </div>
    </div>
  );
}

function Halves({ race }: { race: RaceAnalysis }) {
  const h = race.halves;
  const faster = h.difference_s < 0 ? "second" : "first";
  const bar = (label: string, time: string, pace: string, highlight: boolean) => (
    <div style={{ flex: 1 }}>
      <div style={eyebrow}>{label}</div>
      <div className="font-mono" style={{ fontSize: 22, fontWeight: 700, color: "var(--inchiostro)", marginTop: 4 }}>
        {time}
      </div>
      <div className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>
        {pace}
      </div>
      <div
        style={{
          height: 6,
          borderRadius: 999,
          marginTop: 8,
          background: highlight ? "var(--verde-tratto-scuro)" : "var(--sabbia-scura)",
        }}
      />
    </div>
  );
  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={eyebrow}>Le due metà</span>
        <span
          className="font-mono"
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: h.difference_s <= 0 ? "var(--verde-testo)" : "var(--corallo-testo)",
          }}
        >
          {signed(h.difference_s)} ({h.split_pct > 0 ? "+" : ""}
          {h.split_pct.toFixed(1)}%)
        </span>
      </div>
      <div style={{ display: "flex", gap: 18, marginTop: 10 }}>
        {bar("Prima metà", h.first_time, h.first_pace, faster === "first")}
        {bar("Seconda metà", h.second_time, h.second_pace, faster === "second")}
      </div>
      {race.fade && (
        <div style={{ fontSize: 12.5, color: "var(--inchiostro-70)", marginTop: 12 }}>
          Dopo il km {Math.round(race.fade.from_km)}:{" "}
          <b className="font-mono">{race.fade.after_pace}</b> contro {race.fade.before_pace} prima (
          {race.fade.change_pct > 0 ? "+" : ""}
          {race.fade.change_pct.toFixed(1)}%) —{" "}
          {race.fade.kind === "tenuta" ? "nessun muro" : race.fade.kind === "calo" ? "leggero calo" : "il muro"}
        </div>
      )}
    </div>
  );
}

/** Pace per 5 km block as bars (taller = faster) with the heart rate on top. */
function SplitChart({ race, lockedFromKm }: { race: RaceAnalysis; lockedFromKm: number | null }) {
  const blocks = race.splits_5k.filter((b) => b.pace_sec);
  const paces = blocks.map((b) => b.pace_sec as number);
  const slow = Math.max(...paces) + 8;
  const fast = Math.min(...paces) - 8;
  const W = 320;
  const H = 150;
  const pad = 22;
  const bw = (W - pad * 2) / blocks.length;
  const y = (p: number) => H - pad - ((slow - p) / (slow - fast)) * (H - pad * 2);
  const hrs = blocks.map((b) => b.hr);
  const hrVals = hrs.filter((v): v is number => v != null);
  const hrMin = Math.min(...hrVals) - 5;
  const hrMax = Math.max(...hrVals) + 5;
  const hy = (v: number) => pad + (1 - (v - hrMin) / (hrMax - hrMin || 1)) * (H - pad * 2.4);
  const avg = paces.reduce((a, b) => a + b, 0) / paces.length;

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={eyebrow}>Ogni 5 km</span>
        <span style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          <span style={{ color: "var(--verde-tratto-scuro)" }}>■</span> passo ·{" "}
          <span style={{ color: "var(--corallo-testo)" }}>●</span> battito
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Passo e battito ogni 5 km" style={{ marginTop: 8 }}>
        <defs>
          <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--lilla-testo)" strokeWidth="1.2" opacity="0.35" />
          </pattern>
        </defs>
        <line x1={pad} x2={W - pad} y1={y(avg)} y2={y(avg)} stroke="var(--inchiostro-35)" strokeDasharray="3 4" />
        {blocks.map((b, i) => {
          const top = y(b.pace_sec as number);
          const faster = (b.pace_sec as number) <= avg;
          const locked = lockedFromKm != null && b.end_km > lockedFromKm;
          return (
            <g key={b.label}>
              <rect
                x={pad + i * bw + 3}
                y={top}
                width={bw - 6}
                height={H - pad - top}
                rx={4}
                fill={faster ? "var(--verde-tratto-scuro)" : "var(--verde-tratto)"}
              />
              {locked && <rect x={pad + i * bw} y={pad / 2} width={bw} height={H - pad * 1.5} fill="url(#hatch)" />}
              <text x={pad + i * bw + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--inchiostro-50)">
                {Math.round(b.end_km)}
              </text>
            </g>
          );
        })}
        {hrVals.length > 1 && (
          <polyline
            fill="none"
            stroke="var(--corallo-testo)"
            strokeWidth="2"
            strokeLinejoin="round"
            points={blocks
              .map((b, i) => (b.hr != null ? `${pad + i * bw + bw / 2},${hy(b.hr)}` : null))
              .filter(Boolean)
              .join(" ")}
          />
        )}
        {blocks.map((b, i) =>
          b.hr != null ? (
            <circle key={`h${i}`} cx={pad + i * bw + bw / 2} cy={hy(b.hr)} r={3} fill="var(--corallo-testo)" />
          ) : null,
        )}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${blocks.length}, 1fr)`, marginTop: 2 }}>
        {blocks.map((b) => (
          <span key={b.label} className="font-mono" style={{ fontSize: 9.5, textAlign: "center", color: "var(--inchiostro-70)" }}>
            {b.pace.replace("/km", "")}
          </span>
        ))}
      </div>
      {lockedFromKm != null && (
        <div style={{ fontSize: 11, color: "var(--inchiostro-50)", marginTop: 8 }}>
          Zona tratteggiata: battito non affidabile, escluso.
        </div>
      )}
    </div>
  );
}

function Decoupling({ race }: { race: RaceAnalysis }) {
  const d = race.decoupling;
  return (
    <div style={card}>
      <span style={eyebrow}>Tenuta aerobica</span>
      {d.available ? (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
            <span className="font-mono" style={{ fontSize: 26, fontWeight: 700, color: "var(--inchiostro)" }}>
              {d.pct.toFixed(1)}%
            </span>
            <span style={{ fontSize: 13, fontWeight: 650, color: "var(--inchiostro-70)" }}>{d.rating}</span>
          </div>
          <div style={{ position: "relative", height: 8, borderRadius: 999, marginTop: 10, background: "linear-gradient(90deg, var(--verde) 0 33%, var(--giallo) 33% 66%, var(--corallo) 66%)" }}>
            <span
              style={{
                position: "absolute",
                top: -4,
                left: `calc(${Math.min(100, Math.max(0, (d.pct / 15) * 100))}% - 8px)`,
                width: 16,
                height: 16,
                borderRadius: 999,
                background: "var(--inchiostro)",
                border: "3px solid var(--crema-card)",
              }}
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 8 }}>
            Quanto il cuore ha dovuto lavorare di più, a parità di passo, nella seconda metà ({d.hr_first} → {d.hr_second} bpm).
            Sotto il 5% è ottimo.
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: "var(--inchiostro-70)", marginTop: 6 }}>{d.reason}</div>
      )}
    </div>
  );
}

function KmTable({ race, lockedFromKm }: { race: RaceAnalysis; lockedFromKm: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={card}>
      <button
        type="button"
        data-track="analisi_gara.km"
        onClick={() => setOpen((o) => !o)}
        style={{ all: "unset", cursor: "pointer", display: "flex", width: "100%", justifyContent: "space-between" }}
      >
        <span style={eyebrow}>Chilometro per chilometro</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>{open ? "Nascondi" : `Mostra ${race.km_splits.length} km`}</span>
      </button>
      {open && (
        <div style={{ marginTop: 10, overflowX: "auto" }}>
          <table className="font-mono" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ color: "var(--inchiostro-50)", textAlign: "right" }}>
                <th style={{ textAlign: "left", fontWeight: 600, padding: "4px 0" }}>km</th>
                <th style={{ fontWeight: 600 }}>passo</th>
                {race.level >= 3 && <th style={{ fontWeight: 600 }}>in piano</th>}
                <th style={{ fontWeight: 600 }}>bpm</th>
                <th style={{ fontWeight: 600 }}>cad.</th>
                <th style={{ fontWeight: 600 }}>D+</th>
              </tr>
            </thead>
            <tbody>
              {race.km_splits.map((k) => {
                const delta = k.vs_avg_pct ?? 0;
                const locked = lockedFromKm != null && k.km > lockedFromKm;
                return (
                  <tr key={k.km} style={{ borderTop: "1px solid var(--sabbia-bordo)", textAlign: "right" }}>
                    <td style={{ textAlign: "left", padding: "5px 0", color: "var(--inchiostro-50)" }}>{k.km}</td>
                    <td style={{ color: delta <= -2 ? "var(--verde-testo)" : delta >= 2 ? "var(--corallo-testo)" : "var(--inchiostro)", fontWeight: 600 }}>
                      {k.pace.replace("/km", "")}
                    </td>
                    {race.level >= 3 && <td style={{ color: "var(--inchiostro-50)" }}>{k.gap_pace.replace("/km", "")}</td>}
                    <td style={{ color: locked ? "var(--inchiostro-35)" : "var(--inchiostro-70)" }}>{locked ? "—" : (k.hr ?? "—")}</td>
                    <td style={{ color: "var(--inchiostro-70)" }}>{k.cadence ?? "—"}</td>
                    <td style={{ color: "var(--inchiostro-50)" }}>{k.gain_m}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Technical({ race, shown }: { race: RaceAnalysis; shown: (s: RaceSection) => boolean }) {
  const tiles: { label: string; value: string; note: string }[] = [];
  if (shown("consistency") && race.consistency) {
    tiles.push({
      label: "Regolarità",
      value: `±${race.consistency.cv_pct.toFixed(1)}%`,
      note: `${race.consistency.rating} · più veloce il ${race.consistency.fastest_km}°`,
    });
  }
  if (shown("mechanics") && race.mechanics) {
    const m = race.mechanics;
    tiles.push({
      label: "Cadenza",
      value: `${m.cadence_start} → ${m.cadence_end}`,
      note: `passi/min (${m.cadence_change_pct > 0 ? "+" : ""}${m.cadence_change_pct.toFixed(1)}%)`,
    });
    tiles.push({
      label: "Falcata",
      value: `${m.stride_start_m.toFixed(2)} → ${m.stride_end_m.toFixed(2)}`,
      note: `metri (${m.stride_change_pct > 0 ? "+" : ""}${m.stride_change_pct.toFixed(1)}%)`,
    });
  }
  if (shown("terrain") && race.terrain) {
    tiles.push({
      label: "Dislivello",
      value: `${race.terrain.gain_m} m`,
      note:
        race.terrain.seconds_per_grade_pct != null && !race.terrain.flat
          ? `${race.terrain.seconds_per_grade_pct}"/km per 1% di pendenza`
          : "percorso pianeggiante",
    });
  }
  if (shown("patterns")) {
    tiles.push({
      label: "Soste",
      value: race.patterns.stops.length ? `${race.patterns.stops.length}` : "nessuna",
      note: race.patterns.stopped_s ? `${race.patterns.stopped_s}" da fermo` : "sempre in movimento",
    });
  }
  if (!tiles.length) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginTop: 12 }}>
      {tiles.map((t) => (
        <div key={t.label} style={{ ...card, marginTop: 0, padding: 14 }}>
          <div style={eyebrow}>{t.label}</div>
          <div className="font-mono" style={{ fontSize: 18, fontWeight: 700, color: "var(--inchiostro)", marginTop: 4 }}>
            {t.value}
          </div>
          <div style={{ fontSize: 11.5, color: "var(--inchiostro-50)", marginTop: 2 }}>{t.note}</div>
        </div>
      ))}
    </div>
  );
}
