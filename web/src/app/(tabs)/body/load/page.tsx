"use client";

import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useBodyLoad } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { sessionDistanceKm, toDateKey } from "@/lib/sessionVisuals";

const ROW_HEIGHT = 100;

export default function LoadPage() {
  const animate = useMountOnce("body-load");
  const { data, isLoading } = useBodyLoad();
  const plan = usePassoStore((s) => s.plan);

  const weeks = (data?.weeks ?? []).map((week) => {
    const start = new Date(week.week_start);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const plannedKm = (plan?.sessions ?? [])
      .filter((s) => s.date >= toDateKey(start) && s.date <= toDateKey(end))
      .reduce((sum, s) => sum + sessionDistanceKm(s), 0);
    return { ...week, plannedKm };
  });

  const maxValue = Math.max(1, ...weeks.map((w) => Math.max(w.completed_load ?? 0, w.plannedKm)));

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/body" />
        <BrandMark height={22} />
      </div>
      <div style={{ marginTop: 14 }}>
        <WordIn active={animate} style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>Stai salendo</WordIn>
      </div>
      <p className="font-serif-italic" style={{ fontSize: 15.5, color: "var(--inchiostro-70)" }}>
        Il carico cresce settimana su settimana, con qualche scarico in mezzo.
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
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: ROW_HEIGHT }}>
              {weeks.map((week) => {
                const completedPx = Math.round(((week.completed_load ?? 0) / maxValue) * ROW_HEIGHT);
                return (
                  <div key={week.week_start} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: ROW_HEIGHT }}>
                    <div
                      className={week.in_progress ? "anim-bar-settle" : undefined}
                      style={{
                        width: "100%",
                        height: completedPx,
                        background: week.in_progress ? "var(--corallo)" : "var(--corallo)",
                        borderRadius: "6px 6px 0 0",
                        transformOrigin: "bottom",
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {weeks.map((week) => (
                <p key={week.week_start} className="font-mono" style={{ flex: 1, textAlign: "center", fontSize: 11, color: "var(--inchiostro-50)", margin: 0 }}>
                  {(week.completed_load ?? 0).toFixed(0)}
                </p>
              ))}
            </div>
            <p style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 10 }}>
              corallo = fatto (Garmin) · le colonne mostrano il carico reale delle ultime {weeks.length} settimane
            </p>
          </SlideUp>

          <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
            <SlideUp active={animate} delayMs={250} style={{ flex: 1, background: "var(--verde)", color: "var(--verde-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: "0 0 4px" }}>Produttivo</p>
              <p className="font-mono" style={{ fontSize: 20, margin: 0 }}>{data?.vo2max ?? "—"}</p>
              <p style={{ fontSize: 10, margin: "2px 0 0" }}>VO₂max</p>
            </SlideUp>
            <SlideUp active={animate} delayMs={300} style={{ flex: 1, background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: "0 0 4px" }}>Acuto su cronico</p>
              <p className="font-mono" style={{ fontSize: 20, margin: 0 }}>{data?.acute_chronic_ratio?.toFixed(2) ?? "—"}</p>
            </SlideUp>
          </div>

          <SlideUp active={animate} delayMs={380} className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", marginTop: 14 }}>
            Stare sopra la fascia consigliata adesso va bene: è il segno che la forma sta salendo.
          </SlideUp>
        </>
      )}
    </div>
  );
}
