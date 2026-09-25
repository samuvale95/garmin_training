"use client";

import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp } from "@/components/motion/primitives";
import { DistributionBar, FindingCard } from "@/components/ExecutionBlocks";
import { PaceProfileCard, PrescriptionCard, SensitivityTable } from "@/components/PrescriptionCard";
import { useMountOnce } from "@/lib/motion";
import { useCoachPlan } from "@/lib/queries";
import { formatShortDate } from "@/lib/format";

/** Screen "Come ti alleni": the diagnosis, and the sessions that change it.
 *
 * The one screen in this app that goes all the way from a measurement to a workout in
 * the plan. Everything else stops at a finding, and a finding the athlete has to
 * translate into a session themselves is a finding most people will not act on.
 *
 * It reads the stored history only -- no imported plan required. That is deliberate and
 * it is what makes it work at all for an account training off the Garmin calendar: the
 * question here is what was *done*, and a plan file only ever says what was intended.
 */
export default function CoachTrainingPage() {
  const animate = useMountOnce("coach-allenarsi");
  const { data, isPending, isError, refetch, isFetching } = useCoachPlan();

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/coach" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>
          Come ti alleni
        </h1>
      </div>

      {isPending ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={150} radius={27} />
          <Skeleton height={200} radius={22} />
        </div>
      ) : isError && !data ? (
        <Failed onRetry={() => refetch()} retrying={isFetching} />
      ) : !data?.zones ? (
        <Empty
          title="Mi mancano le tue zone"
          body="Per dire se una seduta è stata facile mi serve la tua frequenza di soglia, che Garmin stima dalle sedute dure. Non la trovo sul tuo account. Preferisco non dirti niente piuttosto che ricavare le zone da 220 meno l'età: l'errore di quella formula è più largo delle zone che dovrebbe definire."
          href="/settings"
          cta="Controlla la connessione a Garmin"
        />
      ) : !data.block ? (
        <Empty
          title="Non ho ancora abbastanza corse"
          body="Servono sedute di corsa con la frequenza cardiaca registrata, sincronizzate su Strava. Le altre attività non entrano: le zone sono tarate su una soglia di corsa, e misurare una sciata con quel righello non vuol dire niente."
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
              {formatShortDate(data.block.from_date)} – {formatShortDate(data.block.to_date)} ·{" "}
              {data.block.sessions} corse
            </p>
            <p style={{ font: "600 34px/1 var(--font-outfit)", letterSpacing: "-.03em", margin: "12px 0 0" }}>
              {Math.round(data.block.easy_share * 100)}%
            </p>
            <p style={{ fontSize: 13.5, color: "var(--inchiostro-su-scuro)", margin: "4px 0 0" }}>
              del tempo di corsa sotto la soglia aerobica
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
                <FindingCard key={finding.key} finding={finding} animate={animate} delayMs={160 + i * 60} />
              ))}
            </div>
          </div>

          {data.prescriptions.length > 0 && (
            <div style={{ marginTop: 26 }}>
              <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
                Cosa fare, in ordine
              </span>
              <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "6px 0 0", lineHeight: 1.45 }}>
                Una cosa per volta. Se vivi nella fascia intermedia, rallentare viene prima di
                aggiungere qualità: farlo al contrario è come ci si è finiti.
              </p>
              {data.prescriptions.map((prescription, i) => (
                <PrescriptionCard
                  key={prescription.key}
                  prescription={prescription}
                  animate={animate}
                  delayMs={260 + i * 80}
                />
              ))}
            </div>
          )}

          {data.profile && (
            <PaceProfileCard easy={data.profile.easy} threshold={data.profile.threshold} animate={animate} delayMs={440} />
          )}

          <SensitivityTable rows={data.sensitivity} animate={animate} delayMs={480} />

          <SlideUp active={animate} delayMs={520} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14 }}>
            <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
              le tue zone
            </p>
            <p className="font-mono" style={{ fontSize: 14, margin: "8px 0 0" }}>{data.zones.describe}</p>
          </SlideUp>

          <p style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "18px 0 0", lineHeight: 1.45 }}>
            Le sedute proposte sono scritte sui tuoi passi misurati, non su una tabella. Restano
            una proposta: nessuna finisce nel piano finché non la aggiungi tu. Orientamento
            sportivo generale, non un consiglio clinico.
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

/** A failed request is not an empty history: saying "mi mancano le tue zone" here would
 * send the athlete off to fix a Garmin connection that is fine. */
function Failed({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20 }}>
        <p style={{ fontWeight: 600, fontSize: 15.5, margin: 0 }}>Non sono riuscito a leggere il tuo storico</p>
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.4 }}>
          È un problema di connessione, non dei tuoi dati. Riprova fra un momento.
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className="press-soft"
        style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: "15px 18px", marginTop: 10, border: "none", color: "inherit", font: "inherit", cursor: "pointer" }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{retrying ? "Riprovo…" : "Riprova"}</span>
        <span aria-hidden="true" className="anim-chev">→</span>
      </button>
    </div>
  );
}
