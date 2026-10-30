"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { Illustration } from "@/components/Illustration";
import { Badge, Section, Stat } from "@/components/ui";
import { ChevronRight } from "@/components/Icons";
import { classifySession, effectiveDescription, effectiveSteps, effectiveTitle, sessionDistanceKm, sessionDurationMinutes } from "@/lib/sessionVisuals";
import { useToggleSessionShort, useWorkoutAnalysis } from "@/lib/queries";
import { capitalize, formatFullDate, formatMinutes, formatPaceRange, formatPaceValue, groupDistanceKm, groupSteps, planStepsSummary, sessionFallbackPaceSecPerKm, stepGroupParts } from "@/lib/format";
import type { StravaActivityMatch, TrainingSession } from "@/lib/types";

const SPORT_LABEL: Record<string, string> = {
  running: "Corsa",
  cycling: "Bici",
  swimming: "Nuoto",
  strength_training: "Forza",
  calisthenics: "Calisthenics",
};

const PHASE_COLOR: Record<string, string> = {
  warmup: "var(--sport-easy)",
  interval: "var(--accent)",
  recovery: "var(--sport-long)",
  rest: "var(--sport-rest)",
  cooldown: "var(--sport-easy)",
};

/** What a planned session asks for: sport, day, how long, the main part, then the
 * phases in order. Figures depend on the sport and only appear when the plan carries
 * them -- nothing is made up to fill the layout. */
export function SessionDetailBody({
  session,
  hasStravaMatch,
  matchData,
  stravaHref,
}: {
  session: TrainingSession;
  animate?: boolean;
  hasStravaMatch: boolean;
  matchData: StravaActivityMatch | undefined;
  stravaHref: string;
}) {
  const toggleShort = useToggleSessionShort();
  const visual = classifySession(session);
  const isShortActive = !!session.is_short_active;
  const steps = effectiveSteps(session);
  const groups = groupSteps(steps);
  const isStrength = session.sport === "calisthenics" || session.sport === "strength_training";
  const isRun = session.sport === "running";
  const fallbackPace = sessionFallbackPaceSecPerKm(steps);
  const durationMin = sessionDurationMinutes(session);
  const distanceKm = sessionDistanceKm(session);
  const hasDistanceSteps = steps.length > 0 && JSON.stringify(steps).includes('"distance"');
  const main = groups.find((g) => g.kind === "interval") ?? null;
  const mainPace = main?.step.target_pace ? `${formatPaceRange(main.step.target_pace)}/km` : null;
  const description = effectiveDescription(session);

  const fullMin = sessionDurationMinutes({ ...session, is_short_active: false });
  const shortMin = session.short_variant?.steps?.length ? sessionDurationMinutes({ ...session, is_short_active: true }) : null;

  const activityId = matchData?.activity_id ?? null;
  const analysisQuery = useWorkoutAnalysis(activityId, hasStravaMatch && !!activityId);

  return (
    <div className="stack-lg" style={{ marginTop: 8 }}>
      <article className="hero" data-sport style={{ "--sport": visual.accent } as CSSProperties} aria-labelledby="session-title">
        <div className="hero-kicker">
          <span className="sport-tag" style={{ "--sport": visual.accent } as CSSProperties}>
            <span className="sport-mark" aria-hidden="true" />
            {SPORT_LABEL[session.sport] ?? capitalize(session.sport)} · {visual.label}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={session.date}>{capitalize(formatFullDate(session.date))}</time>
          {session.priority === "key" && <Badge tone="warn">Seduta chiave</Badge>}
          {isShortActive && <Badge tone="accent">Versione breve</Badge>}
        </div>
        <h1 className="hero-title" id="session-title">{effectiveTitle(session)}</h1>
        {description && <p className="hero-text">{description}</p>}
        <div className="hero-figures">
          {durationMin > 0 && <Stat value={formatMinutes(durationMin)} label={isStrength ? "Durata stimata" : "Durata prevista"} />}
          {!isStrength && distanceKm > 0 && (session.sport !== "cycling" || hasDistanceSteps) && (
            <Stat value={distanceKm.toLocaleString("it-IT", { maximumFractionDigits: 1 })} unit="km" label={isRun ? "Distanza stimata" : "Distanza"} />
          )}
          {isRun && mainPace && <Stat value={<span style={{ fontSize: "var(--text-xl)" }}>{mainPace}</span>} label="Passo della parte principale" />}
          {groups.length > 0 && <Stat value={groups.length} label={groups.length === 1 ? "fase" : "fasi"} />}
        </div>
        {visual.illustration && (
          <div className="hero-art" aria-hidden="true">
            <Illustration name={visual.illustration} width={150} height={160} position="relative" active={false} priority />
          </div>
        )}
      </article>

      {session.short_variant && session.id && (
        <Section title="Versione breve" id="session-short">
          <div className="card">
            <div className="stats" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <Stat value={formatMinutes(fullMin)} label="Completa" note={isShortActive ? undefined : "In uso"} />
              <Stat value={shortMin != null ? formatMinutes(shortMin) : "—"} label="Breve" note={isShortActive ? "In uso" : shortMin != null && fullMin > shortMin ? `${Math.round(fullMin - shortMin)} min in meno` : undefined} />
            </div>
            {session.short_variant.steps?.length > 0 && (
              <p className="card-text">Fasi della versione breve: {planStepsSummary(session.short_variant.steps)}</p>
            )}
            {session.short_variant.description && <p className="card-text">{session.short_variant.description}</p>}
            <div className="actions">
              <button type="button" className="btn" data-variant={isShortActive ? undefined : "primary"} data-track="session.toggle-short" onClick={() => toggleShort(session.id!)}>
                {isShortActive ? "Ripristina la versione completa" : "Usa la versione breve"}
              </button>
            </div>
            <p className="card-text" style={{ fontSize: "var(--text-xs)" }}>Il cambio si applica al piano nell’app e si può annullare in ogni momento.</p>
          </div>
        </Section>
      )}

      <Section title="Struttura" id="session-structure">
        {groups.length === 0 ? (
          <div className="card"><p className="card-text" style={{ margin: 0 }}>Seduta continua, senza fasi strutturate.</p></div>
        ) : (
          <ol className="list" style={{ listStyle: "none" }}>
            {groups.map((group, i) => {
              const { label, detail } = stepGroupParts(group);
              const km = isStrength ? 0 : groupDistanceKm(group, fallbackPace);
              return (
                <li key={group.startIndex ?? i}>
                  <div className="row" style={{ alignItems: "stretch" }}>
                    <span aria-hidden="true" style={{ width: 4, borderRadius: 2, background: PHASE_COLOR[group.kind] ?? "var(--line-strong)", flex: "none" }} />
                    <span className="row-main">
                      <span className="row-title">{label}</span>
                      {detail && <span className="row-meta figure" style={{ fontVariationSettings: "normal" }}>{detail}</span>}
                    </span>
                    {km > 0 && <span className="row-end figure" style={{ color: "var(--ink)" }}>{km.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km</span>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {isRun && distanceKm > 0 && (
          <p className="muted" style={{ fontSize: "var(--text-xs)", margin: "8px 2px 0" }}>Le distanze delle fasi a tempo sono stimate dal passo indicato.</p>
        )}
      </Section>

      {hasStravaMatch && matchData && (
        <Section title="Com’è andata" id="session-done">
          <ul className="list">
            <li>
              <Link className="row" href={stravaHref} data-track="session-detail-body.stravahref">
                <span className="row-main">
                  <span className="row-title">Attività registrata su Strava</span>
                  <span className="row-meta figure">
                    {matchData.distance_km != null ? `${matchData.distance_km.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km` : "Distanza non disponibile"}
                    {matchData.avg_pace_sec_per_km != null && ` · ${formatPaceValue(matchData.avg_pace_sec_per_km)}`}
                  </span>
                </span>
                <span className="row-end"><Badge tone="ok">Svolto</Badge><ChevronRight size={16} aria-hidden="true" /></span>
              </Link>
            </li>
          </ul>
          {analysisQuery.data && (
            <div className="card" style={{ marginTop: 12 }}>
              <p className="card-title">{analysisQuery.data.headline}</p>
              <p className="card-text">{analysisQuery.data.summary_deterministic}</p>
              <div className="actions">
                <Link className="btn" data-size="sm" href={stravaHref} data-track="session-detail-body.analysis">
                  Previsto ed eseguito a confronto
                </Link>
              </div>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
