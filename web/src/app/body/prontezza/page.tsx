"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ProgressRing, Skeleton, SlideUp } from "@/components/motion/primitives";
import { READINESS_BANDS, ReadinessFactorList, SleepPhaseLegend, readinessBand } from "@/components/BodyCards";
import { useMountOnce } from "@/lib/motion";
import { useBodyToday } from "@/lib/queries";
import { formatMinutes } from "@/lib/format";

/** Screen "Prontezza": what the number on the Corpo card actually is.
 *
 * It exists because the card showed a 64 inside a ring with `MOD_RT_LOW_SS_GOOD`
 * printed underneath it -- a score with no scale, no inputs and an untranslated Garmin
 * lookup key for an explanation. Everything here is the answer to one question a user
 * should never have had to ask: sessantaquattro *di cosa*.
 *
 * Nothing on this screen is computed here. The bands are Garmin's own quartiles, the
 * factors are the per-input contributions Garmin returns with the score, and the
 * sentence is the decoded feedback key (see `garmin_labels.py`).
 */
export default function ReadinessPage() {
  const animate = useMountOnce("body-prontezza");
  const { data, isPending } = useBodyToday();

  const score = data?.readiness_score ?? null;
  const band = score != null ? readinessBand(score) : null;

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/body" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>
          Prontezza
        </h1>
      </div>

      {isPending ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={150} radius={27} />
          <Skeleton height={220} radius={22} />
        </div>
      ) : score == null ? (
        <SlideUp active={animate} delayMs={80} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 18 }}>
          <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>Nessun punteggio per stamattina</p>
          <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.35 }}>
            La prontezza la calcola l&apos;orologio durante la notte. Senza una sincronizzazione
            recente non c&apos;è niente da spiegare.
          </p>
        </SlideUp>
      ) : (
        <>
          <SlideUp
            active={animate}
            delayMs={80}
            style={{
              background: "var(--verde)",
              color: "var(--verde-testo)",
              borderRadius: "var(--radius-card-lg)",
              padding: 22,
              marginTop: 18,
              display: "flex",
              alignItems: "center",
              gap: 18,
            }}
          >
            <ProgressRing value={score / 100} size={96} strokeWidth={10} trackColor="rgba(31,51,16,.15)" color="var(--verde-testo)">
              <p className="font-mono" style={{ fontSize: 25, fontWeight: 500, margin: 0 }}>{score}</p>
            </ProgressRing>
            <div style={{ minWidth: 0 }}>
              <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.7, margin: 0 }}>
                su 100
              </p>
              <p style={{ font: "600 22px/1.15 var(--font-outfit)", letterSpacing: "-.02em", margin: "6px 0 0" }}>
                Prontezza {band?.label}
              </p>
              <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.35, margin: "8px 0 0", opacity: 0.92 }}>
                {band?.meaning}
              </p>
            </div>
          </SlideUp>

          <Section title="Che cos'è">
            <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.4, color: "var(--inchiostro-70)", margin: 0 }}>
              Un voto da 0 a 100 che l&apos;orologio calcola ogni mattina mettendo insieme quanto
              e come hai dormito, la variabilità del battito durante la notte, quanto recupero
              ti resta dagli allenamenti recenti e lo stress degli ultimi giorni. Non è una
              misura della tua forma: dice solo quanto il corpo è disposto a lavorare oggi.
            </p>
          </Section>

          <Section title="Le fasce">
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              {READINESS_BANDS.map((entry, i) => {
                const from = i === 0 ? 0 : READINESS_BANDS[i - 1].upper;
                const to = Math.min(entry.upper - 1, 100);
                const current = entry.label === band?.label;
                return (
                  <div
                    key={entry.label}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 12,
                      background: current ? "var(--verde)" : "var(--crema-card)",
                      color: current ? "var(--verde-testo)" : "inherit",
                      borderRadius: "var(--radius-row)",
                      padding: "12px 15px",
                    }}
                  >
                    <span className="font-mono" style={{ fontSize: 12.5, width: 52, flex: "none" }}>
                      {from}–{to}
                    </span>
                    <span style={{ fontSize: 14, fontWeight: current ? 700 : 600, flex: "none", width: 88 }}>{entry.label}</span>
                    <span style={{ fontSize: 12.5, opacity: 0.75, lineHeight: 1.35 }}>{entry.meaning}</span>
                  </div>
                );
              })}
            </div>
          </Section>

          {data?.readiness_factors && data.readiness_factors.length > 0 && (
            <Section title="Da cosa nasce il tuo">
              <ReadinessFactorList factors={data.readiness_factors} />
              <p style={{ fontSize: 11.5, color: "var(--inchiostro-35)", margin: "10px 0 0", lineHeight: 1.45 }}>
                Sono i pesi che l&apos;orologio dichiara per ciascun ingrediente: più la barra è
                piena, più quell&apos;ingrediente ti sta aiutando oggi.
              </p>
            </Section>
          )}

          {data?.readiness_message && (
            <Section title="Come lo riassume l'orologio">
              <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.4, color: "var(--inchiostro-70)", margin: 0 }}>
                {data.readiness_message}
              </p>
            </Section>
          )}

          {data?.sleep && (
            <Section title="La notte dietro al punteggio">
              <p style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "0 0 12px", lineHeight: 1.4 }}>
                {formatMinutes(data.sleep.total_minutes ?? 0)} in tutto
                {data.sleep.score != null && `, qualità ${data.sleep.score} su 100`}.
              </p>
              <SleepPhaseLegend sleep={data.sleep} />
            </Section>
          )}

          <SlideUp active={animate} delayMs={340} style={{ marginTop: 18 }}>
            <Link
              href="/body/stato"
              className="press-soft"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                background: "var(--sabbia)",
                borderRadius: "var(--radius-card)",
                padding: "15px 18px",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ font: "600 15.5px/1.2 var(--font-outfit)", margin: 0 }}>E l&apos;allenamento di oggi?</p>
                <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.35 }}>
                  Questo è il punteggio dell&apos;orologio. Il giudizio su cosa farne è in Stato del
                  giorno, e usa anche il carico e la seduta in programma.
                </p>
              </div>
              <span aria-hidden="true" className="anim-chev" style={{ flex: "none", fontSize: 18 }}>→</span>
            </Link>
          </SlideUp>

          <p style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "18px 0 0", lineHeight: 1.45 }}>
            Il punteggio lo calcola Garmin, non quest&apos;app: qui è solo spiegato. Orientamento
            sportivo generale, non un consiglio clinico.
          </p>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 22 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
        {title}
      </span>
      <div style={{ marginTop: 10 }}>{children}</div>
    </div>
  );
}
