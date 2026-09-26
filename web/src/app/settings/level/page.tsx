"use client";

import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useAthleteLevel } from "@/lib/queries";
import type { AthleteLevel, LevelCriterion } from "@/lib/types";

/** Screen "Livello": where you are from a first run to athlete level, and what the next
 * step asks for.
 *
 * A list of criteria rather than a badge on purpose: "4 settimane attive su 6" tells you
 * what to do next, a level number on its own does not. There is nothing to edit here --
 * the level is computed from the history and only goes up.
 */
export default function LevelSettingsPage() {
  const animate = useMountOnce("settings-level");
  const { data, isPending, isError } = useAthleteLevel();

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/settings" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>impostazioni</span>
      </div>

      <WordIn active={animate} as="h1" style={{ font: "600 30px/1.06 var(--font-outfit)", letterSpacing: "-.03em", margin: "16px 0 16px" }}>
        Il tuo livello
      </WordIn>

      {isPending ? (
        <Skeleton height={160} radius={27} />
      ) : isError || !data ? (
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)" }}>
          Non sono riuscito a calcolare il tuo livello. Riprova fra un momento.
        </p>
      ) : (
        <>
          <SlideUp
            active={animate}
            delayMs={80}
            style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 22 }}
          >
            <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)", margin: 0 }}>
              livello {data.level} di 3
            </p>
            <p style={{ font: "600 34px/1 var(--font-outfit)", letterSpacing: "-.03em", margin: "12px 0 0" }}>{data.level_name}</p>
            <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.35, margin: "12px 0 0" }}>
              {data.level_meaning}
            </p>
          </SlideUp>

          {data.state !== "attivo" && <StateNote level={data} />}

          <CriteriaList
            animate={animate}
            title={data.next.length ? `Per il livello ${data.level + 1}` : "Cosa ti tiene qui"}
            criteria={data.next.length ? data.next : data.current}
          />

          <p style={{ fontSize: 12.5, color: "var(--inchiostro-35)", marginTop: 16, lineHeight: 1.4 }}>
            Il livello si calcola dai tuoi allenamenti e non scende: dopo una pausa resti dove sei arrivato.
          </p>
        </>
      )}
    </div>
  );
}

function StateNote({ level }: { level: AthleteLevel }) {
  const text =
    level.state === "pausa"
      ? "Nelle ultime quattro settimane gli allenamenti sono stati pochi."
      : "Stai riprendendo dopo una pausa.";
  const lower = level.effective_level < level.level;
  return (
    <div style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 12 }}>
      <p style={{ fontWeight: 600, fontSize: 14.5, margin: 0 }}>{level.state === "pausa" ? "In pausa" : "In ripresa"}</p>
      <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.4 }}>
        {text}
        {lower && ` Per qualche settimana carichi e avvisi sono quelli del livello ${level.effective_level}; il tuo livello resta ${level.level}.`}
      </p>
    </div>
  );
}

function CriteriaList({ animate, title, criteria }: { animate: boolean; title: string; criteria: LevelCriterion[] }) {
  return (
    <div style={{ marginTop: 22 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
        {title}
      </span>
      {criteria.map((criterion, i) => (
        <SlideUp
          key={criterion.key}
          active={animate}
          delayMs={140 + i * 50}
          style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: "14px 16px", marginTop: 8 }}
        >
          <span aria-hidden="true" style={{ fontSize: 15, color: criterion.met ? "var(--verde-testo)" : "var(--inchiostro-35)" }}>
            {criterion.met ? "✓" : "○"}
          </span>
          <span style={{ flex: 1, fontSize: 14, lineHeight: 1.35 }}>{criterion.label}</span>
          <span className="font-mono" style={{ fontSize: 13, color: criterion.met ? "var(--inchiostro)" : "var(--inchiostro-50)", whiteSpace: "nowrap" }}>
            {formatCriterion(criterion)}
          </span>
        </SlideUp>
      ))}
    </div>
  );
}

function formatCriterion(criterion: LevelCriterion): string {
  if (!criterion.unit) return criterion.met ? "sì" : "no";
  return `${Math.round(criterion.measured)} / ${Math.round(criterion.required)}`;
}
