"use client";

import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useBodyLoad, usePlanQuery } from "@/lib/queries";
import { isoWeekNumber, sessionDistanceKm, toDateKey } from "@/lib/sessionVisuals";

const ROW_HEIGHT = 100;

function loadState(ratio: number | null): { label: string; caption: string } {
  if (ratio == null) return { label: "—", caption: "" };
  if (ratio > 1.5) return { label: "A rischio", caption: "il carico sale troppo in fretta" };
  if (ratio > 1.1) return { label: "Produttivo", caption: "il carico paga: forma in salita" };
  if (ratio >= 0.8) return { label: "Mantenimento", caption: "il carico regge la forma attuale" };
  return { label: "In calo", caption: "il carico è sceso, la forma può calare" };
}

export default function LoadPage() {
  const animate = useMountOnce("body-load");
  const { data, isLoading } = useBodyLoad();
  const { data: plan } = usePlanQuery();

  function plannedKmForWeek(start: Date): number {
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return (plan?.sessions ?? [])
      .filter((s) => s.date >= toDateKey(start) && s.date <= toDateKey(end))
      .reduce((sum, s) => sum + sessionDistanceKm(s), 0);
  }

  const pastWeeks = (data?.weeks ?? []).map((week) => ({
    ...week,
    plannedKm: plannedKmForWeek(new Date(week.week_start)),
  }));

  // Garmin only ever reports completed/in-progress weeks -- the design's chart also
  // shows the plan's next couple of weeks ("previsto") with no "fatto" bar yet, so
  // those are appended purely from the client-side plan, never from the backend.
  const futureWeeks = [];
  if (pastWeeks.length > 0) {
    const lastStart = new Date(pastWeeks[pastWeeks.length - 1].week_start);
    for (let i = 1; i <= 2; i++) {
      const start = new Date(lastStart);
      start.setDate(lastStart.getDate() + 7 * i);
      futureWeeks.push({ week_start: toDateKey(start), completed_load: null, in_progress: false, plannedKm: plannedKmForWeek(start) });
    }
  }

  const weeks = [...pastWeeks, ...futureWeeks];
  const maxValue = Math.max(1, ...weeks.map((w) => Math.max(w.completed_load ?? 0, w.plannedKm)));

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader backHref="/body" />
          <BrandMark height={22} />
        </div>
        <span style={{ fontSize: 11, color: "var(--inchiostro-35)", fontWeight: 500 }}>carico · 4 settimane</span>
      </div>
      <div style={{ marginTop: 14 }}>
        <WordIn active={animate} style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>Stai salendo</WordIn>
      </div>
      <p className="font-serif-italic" style={{ fontSize: 15.5, color: "var(--inchiostro-70)" }}>
        Tre settimane in crescita e una di scarico in arrivo. È esattamente la forma che il tuo file disegna.
      </p>

      {isLoading ? (
        <p>Carico i dati…</p>
      ) : (
        <>
          <SlideUp
            active={animate}
            delayMs={150}
            style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, marginBottom: 10 }}>
              <Legend color="var(--corallo)" label="fatto" />
              <Legend color="var(--sabbia-bordo)" label="previsto" />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: ROW_HEIGHT }}>
              {weeks.map((week) => {
                const completedPx = Math.round(((week.completed_load ?? 0) / maxValue) * ROW_HEIGHT);
                const plannedPx = Math.round((week.plannedKm / maxValue) * ROW_HEIGHT);
                return (
                  <div key={week.week_start} style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 3, height: ROW_HEIGHT }}>
                    <div
                      className={week.in_progress ? "anim-bar-settle" : undefined}
                      style={{ width: "45%", height: completedPx, background: "var(--corallo)", borderRadius: "4px 4px 0 0", transformOrigin: "bottom" }}
                    />
                    <div style={{ width: "45%", height: plannedPx, background: "var(--sabbia-bordo)", borderRadius: "4px 4px 0 0" }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {weeks.map((week) => {
                const weekNumber = isoWeekNumber(new Date(week.week_start));
                return (
                  <p
                    key={week.week_start}
                    className="font-mono"
                    style={{ flex: 1, textAlign: "center", fontSize: 11, color: week.in_progress ? "var(--inchiostro)" : "var(--inchiostro-50)", fontWeight: week.in_progress ? 700 : 400, margin: 0 }}
                  >
                    {weekNumber}
                  </p>
                );
              })}
            </div>
            {(() => {
              const priorWeeks = weeks.slice(0, -1);
              const avgPrior = priorWeeks.reduce((sum, w) => sum + Math.max(w.completed_load ?? 0, w.plannedKm), 0) / (priorWeeks.length || 1);
              const lastWeek = weeks[weeks.length - 1];
              if (!lastWeek || avgPrior <= 0 || lastWeek.plannedKm >= avgPrior * 0.7) return null;
              const dropPct = Math.round((1 - lastWeek.plannedKm / avgPrior) * 100);
              return (
                <p style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 10 }}>
                  settimana {isoWeekNumber(new Date(lastWeek.week_start))} è lo scarico: −{dropPct}% di carico
                </p>
              );
            })()}
          </SlideUp>

          <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
            <SlideUp active={animate} delayMs={250} style={{ flex: 1, background: "var(--verde)", color: "var(--verde-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: "0 0 4px" }}>Stato</p>
              <p style={{ font: "600 18px/1 var(--font-outfit)", margin: 0 }}>{loadState(data?.acute_chronic_ratio ?? null).label}</p>
              <p style={{ fontSize: 11, margin: "6px 0 0" }}>{loadState(data?.acute_chronic_ratio ?? null).caption}</p>
            </SlideUp>
            <SlideUp active={animate} delayMs={280} style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: "0 0 4px", color: "var(--inchiostro-50)" }}>VO₂ max</p>
              <p className="font-mono" style={{ fontSize: 20, margin: 0 }}>{data?.vo2max ?? "—"}</p>
            </SlideUp>
          </div>

          <SlideUp active={animate} delayMs={320} style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: 0 }}>Acuto su cronico</p>
              <p className="font-mono" style={{ fontSize: 18, margin: 0 }}>{data?.acute_chronic_ratio?.toFixed(2) ?? "—"}</p>
            </div>
            {data?.acute_chronic_ratio != null && (
              <div style={{ position: "relative", height: 4, borderRadius: 100, background: "rgba(31,51,16,.15)", marginTop: 12 }}>
                <div
                  style={{
                    position: "absolute",
                    top: -3,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--giallo-testo)",
                    left: `calc(${Math.min(100, Math.max(0, (data.acute_chronic_ratio / 2) * 100))}% - 5px)`,
                  }}
                />
              </div>
            )}
            <p className="font-serif-italic" style={{ fontSize: 13, margin: "12px 0 0" }}>
              Sopra la fascia comoda, ma è il punto della stagione in cui deve stare. Dopo lo scarico torna a posto.
            </p>
          </SlideUp>

          <SlideUp active={animate} delayMs={380} className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", marginTop: 14 }}>
            Stare sopra la fascia consigliata adesso va bene: è il segno che la forma sta salendo.
          </SlideUp>
        </>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--inchiostro-50)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
