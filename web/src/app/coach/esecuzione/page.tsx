"use client";

import { useMemo } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp } from "@/components/motion/primitives";
import { DistributionBar, FindingCard, SessionExecutionRow } from "@/components/ExecutionBlocks";
import { useMountOnce } from "@/lib/motion";
import { useExecutionBlock, usePlanQuery } from "@/lib/queries";
import { shiftDateKey, toDateKey } from "@/lib/sessionVisuals";
import { formatShortDate } from "@/lib/format";

/** Screen "Come ti alleni davvero": the plan's intention against the stream's verdict.
 *
 * This is the screen that can catch a mistake the athlete is certain they are not
 * making. Running the easy days too hard is the most common error in endurance training,
 * and the people who make it are sure they do not -- because every individual run feels
 * reasonable at the time. Only the distribution settles it, and only a second-by-second
 * stream can produce the distribution.
 *
 * Every claim carries a badge saying what kind of claim it is: a measurement, a finding
 * from the research, or a correlation in this athlete's own uncontrolled data. Three very
 * different levels of confidence, and reading them in the same voice is how an app ends
 * up sounding certain about things nobody is certain about.
 */

// Eight weeks: long enough for a distribution to mean something, short enough to still
// describe the block being trained rather than the athlete's whole history.
const BLOCK_WEEKS = 8;

export default function ExecutionPage() {
  const animate = useMountOnce("coach-esecuzione");
  const { data: plan, isHydrated } = usePlanQuery();

  // `shiftDateKey` rather than arithmetic on `Date.now()`: the latter is a call the
  // render-purity rule rejects inside a memo, and the helper is what the rest of the app
  // already uses to walk the calendar.
  const today = toDateKey(new Date());
  const sessions = useMemo(() => {
    const from = shiftDateKey(today, -BLOCK_WEEKS * 7);
    return (plan?.sessions ?? []).filter((s) => s.date >= from && s.date <= today);
  }, [plan, today]);

  const query = useExecutionBlock(sessions, isHydrated);
  const data = query.data;

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/coach" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>
          Come ti alleni davvero
        </h1>
      </div>

      {!isHydrated || query.isPending ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={140} radius={27} />
          <Skeleton height={180} radius={22} />
        </div>
      ) : sessions.length === 0 ? (
        <Empty
          title="Nessuna seduta nelle ultime otto settimane"
          body="Questa schermata confronta quello che il piano chiedeva con quello che hai fatto davvero. Senza un piano importato non c'è il primo dei due termini."
          href="/import"
          cta="Importa un piano"
        />
      ) : !data?.zones ? (
        <Empty
          title="Mi mancano le tue zone"
          body="Per dire se una seduta è stata facile mi serve la tua frequenza di soglia, che Garmin stima dalle sedute dure. Non la trovo sul tuo account. Preferisco non mostrarti niente piuttosto che zone ricavate da 220 meno l'età: l'errore di quella formula è più largo delle zone che dovrebbe definire."
          href="/settings"
          cta="Controlla la connessione a Garmin"
        />
      ) : !data.block ? (
        <Empty
          title="Nessuna seduta con la fascia cardiaca"
          body="Le sedute ci sono, ma nessuna ha uno stream di frequenza da leggere. Serve un orologio o una fascia che la registri, e l'attività va sincronizzata su Strava."
          href="/settings"
          cta="Controlla la connessione a Strava"
        />
      ) : (
        <>
          <SlideUp
            active={animate}
            delayMs={80}
            style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 22, marginTop: 18 }}
          >
            <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)", margin: 0 }}>
              {formatShortDate(data.block.from_date)} – {formatShortDate(data.block.to_date)} · {data.block.sessions} sedute
            </p>
            <p style={{ font: "600 34px/1 var(--font-outfit)", letterSpacing: "-.03em", margin: "12px 0 0" }}>
              {Math.round(data.block.easy_share * 100)}%
            </p>
            <p style={{ fontSize: 13.5, color: "var(--inchiostro-su-scuro)", margin: "4px 0 0" }}>
              del tempo sotto la soglia aerobica
            </p>
            <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.35, margin: "14px 0 0" }}>
              Il riferimento dell&apos;allenamento polarizzato è circa l&apos;80%. È la base aerobica a
              crescere lì, non nella fascia intermedia.
            </p>
          </SlideUp>

          <DistributionBar block={data.block} animate={animate} />

          <div style={{ marginTop: 22 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
              Cosa dicono i dati
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {data.block.findings.map((finding, i) => (
                <FindingCard key={finding.key} finding={finding} animate={animate} delayMs={200 + i * 60} />
              ))}
            </div>
          </div>

          <SlideUp active={animate} delayMs={380} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14 }}>
            <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
              le tue zone
            </p>
            <p className="font-mono" style={{ fontSize: 14, margin: "8px 0 0" }}>{data.zones.describe}</p>
            <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "8px 0 0", lineHeight: 1.4 }}>
              Ricavate dalla soglia del lattato che Garmin stima dalle tue sedute
              ({data.zones.threshold_hr} bpm), non da una formula sull&apos;età.
            </p>
          </SlideUp>

          {data.sessions.length > 0 && (
            <div style={{ marginTop: 22 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
                Seduta per seduta
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                {data.sessions.map((execution, i) => (
                  <SessionExecutionRow
                    key={execution.activity_id}
                    execution={execution}
                    animate={animate}
                    delayMs={420 + i * 40}
                  />
                ))}
              </div>
            </div>
          )}

          <p style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "18px 0 0", lineHeight: 1.45 }}>
            La frequenza cardiaca insegue lo sforzo con un minuto o due di ritardo, e sale con
            il caldo, le salite e la disidratazione a parità di fatica. Una singola seduta fuori
            posto non vuol dire niente: conta la distribuzione. Orientamento sportivo generale,
            non un consiglio clinico.
          </p>
        </>
      )}
    </div>
  );
}

function Empty({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20 }}>
        <p style={{ fontWeight: 600, fontSize: 15.5, margin: 0 }}>{title}</p>
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.4 }}>
          {body}
        </p>
      </div>
      <Link
        href={href}
        className="press-soft"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: "15px 18px", marginTop: 10, textDecoration: "none", color: "inherit" }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{cta}</span>
        <span aria-hidden="true" className="anim-chev">→</span>
      </Link>
    </div>
  );
}
