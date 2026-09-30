"use client";

import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp, WordIn } from "@/components/motion/primitives";
import { Mascot, Tokens } from "@/components/ProgressBits";
import { formatFullDate } from "@/lib/format";
import { useMountOnce } from "@/lib/motion";
import { useProgress } from "@/lib/queries";
import type { Badge } from "@/lib/types";

/** "Progressi": the streak, this week's Disciplina points with every reason, the badges.
 * Nothing here rewards volume (see `training_plan/progress.py`): points come from
 * showing up, respecting rest and listening to the body. */
export default function ProgressPage() {
  const animate = useMountOnce("progress");
  const { data, isPending, isError } = useProgress();

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/today" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>progressi</span>
      </div>

      <WordIn active={animate} as="h1" style={{ font: "600 30px/1.06 var(--font-sans)", letterSpacing: "-.03em", margin: "16px 0 16px" }}>
        I tuoi progressi
      </WordIn>

      {isPending ? (
        <Skeleton height={200} radius={27} />
      ) : isError || !data ? (
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)" }}>
          Non sono riuscito a calcolare i progressi. Riprova fra un momento.
        </p>
      ) : (
        <>
          <SlideUp active={animate} delayMs={80} style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 20, display: "flex", gap: 14, alignItems: "center" }}>
            <div style={{ flex: 1 }}>
              <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)", margin: 0 }}>
                serie
              </p>
              <p style={{ font: "600 40px/1 var(--font-sans)", letterSpacing: "-.03em", margin: "8px 0 0" }}>
                {data.streak}
                <span style={{ fontSize: 15, fontWeight: 500 }}> {data.streak === 1 ? "settimana" : "settimane"} di fila</span>
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                <Tokens tokens={data.tokens} max={data.max_tokens} />
                <span style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>salva-serie</span>
              </div>
              <p className="font-serif-italic" style={{ fontSize: 14, lineHeight: 1.35, margin: "12px 0 0" }}>
                {data.mascot.sentence}
              </p>
            </div>
            <Mascot state={data.mascot.state} size={96} />
          </SlideUp>

          <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "10px 2px 0", lineHeight: 1.4 }}>
            Una settimana è attiva con almeno 2 allenamenti. Ogni 4 settimane di fila guadagni un salva-serie (massimo{" "}
            {data.max_tokens}); una settimana con dolore segnalato non rompe la serie.
          </p>

          <SlideUp active={animate} delayMs={160} style={{ background: "var(--crema-card)", border: "1px solid var(--border-airbnb)", boxShadow: "var(--shadow-airbnb-subtle)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 16 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <p style={{ font: "500 11.5px var(--font-sans)", color: "var(--inchiostro-50)", margin: 0 }}>Punti Disciplina, questa settimana</p>
              <p style={{ font: "600 22px/1 var(--font-sans)", margin: 0 }}>{data.week_points}</p>
            </div>
            {data.week_lines.length === 0 ? (
              <p style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: "8px 0 0" }}>
                Ancora niente: i giorni contano quando sono finiti.
              </p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "flex", flexDirection: "column", gap: 6 }}>
                {data.week_lines.map((line, i) => (
                  <li key={`${line.date}-${i}`} style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.35 }}>
                    <span className="font-mono" style={{ width: 34, flex: "none", textAlign: "right", color: line.points < 0 ? "var(--rosso-avviso)" : "var(--verde-tratto-scuro)" }}>
                      {line.points > 0 ? `+${line.points}` : line.points}
                    </span>
                    <span>{line.reason}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "10px 0 0" }}>
              {data.total_points} punti nelle ultime 52 settimane
            </p>
          </SlideUp>

          <p style={{ font: "500 11.5px var(--font-sans)", color: "var(--inchiostro-50)", margin: "20px 2px 8px" }}>Traguardi</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 9 }}>
            {data.badges.map((badge, i) => (
              <BadgeCard key={badge.key} badge={badge} animate={animate} delayMs={220 + i * 40} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function BadgeCard({ badge, animate, delayMs }: { badge: Badge; animate: boolean; delayMs: number }) {
  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{
        background: badge.earned ? "var(--corallo)" : "var(--crema-card)",
        color: badge.earned ? "var(--corallo-testo)" : undefined,
        border: "1px solid var(--border-airbnb)",
        boxShadow: "var(--shadow-airbnb-subtle)",
        borderRadius: "var(--radius-card)",
        padding: 12,
        opacity: badge.earned ? 1 : 0.85,
      }}
    >
      <p style={{ fontWeight: 600, fontSize: 14, margin: 0 }}>{badge.title}</p>
      <p style={{ fontSize: 12, lineHeight: 1.35, margin: "4px 0 0", opacity: 0.8 }}>{badge.description}</p>
      <p className="font-mono" style={{ fontSize: 11, margin: "8px 0 0", opacity: 0.75 }}>
        {badge.earned ? (badge.earned_on ? formatFullDate(badge.earned_on) : "raggiunto") : `${badge.progress}/${badge.target}`}
      </p>
    </SlideUp>
  );
}
