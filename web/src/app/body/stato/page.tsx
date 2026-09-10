"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useBodyToday, useDayVerdict, useDayVerdictNarrative, useUpdateSession, useWeekWorkouts } from "@/lib/queries";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { countdownLabel, goalTitle } from "@/lib/raceGoal";
import { isRepeatBlock, type DayVerdict, type DaySignal, type SessionStep, type TrainingSession } from "@/lib/types";

const SEVERITY_STYLE: Record<string, { background: string; color: string; label: string }> = {
  forte: { background: "var(--rosa-avviso)", color: "var(--rosso-testo)", label: "forte" },
  moderato: { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", label: "moderato" },
  info: { background: "var(--sabbia-chip)", color: "var(--inchiostro-70)", label: "nota" },
};

const STATE_HEADER: Record<string, { background: string; color: string; overline: string }> = {
  pronto: { background: "var(--verde)", color: "var(--verde-testo)", overline: "puoi allenarti" },
  cauto: { background: "var(--giallo)", color: "var(--giallo-testo)", overline: "si può, con giudizio" },
  scarico: { background: "var(--corallo)", color: "var(--corallo-testo)", overline: "oggi meglio di no" },
  sconosciuto: { background: "var(--sabbia)", color: "var(--inchiostro-70)", overline: "dati mancanti" },
};

/** Drop one repetition from a session -- the "tienila, ma più morbida" edit.
 *
 * Deliberately the smallest possible change to the file: a repeat block loses one rep,
 * and a session written as loose interval steps loses its last effort. Anything cleverer
 * would be the app rewriting a workout it did not author. */
function softenSession(session: TrainingSession): TrainingSession {
  const steps: SessionStep[] = [];
  let dropped = false;
  for (const item of session.steps) {
    if (!dropped && isRepeatBlock(item) && item.reps > 2) {
      steps.push({ ...item, reps: item.reps - 1 });
      dropped = true;
      continue;
    }
    steps.push(item);
  }
  if (dropped) return { ...session, steps };

  const lastEffort = [...session.steps].reverse().find((item) => !isRepeatBlock(item) && item.type === "interval");
  if (!lastEffort) return session;
  return { ...session, steps: session.steps.filter((item) => item !== lastEffort) };
}

/** The title an easy version of this session should carry, in its own sport.
 *
 * Keeping the sport is the point: the first version of this rewrote a strength session
 * into "Fondo facile" and left `sport: strength_training` on it -- a run, in the gym,
 * according to the file. An easy day is a lighter version of the same thing, not a
 * different sport. */
const EASY_TITLE: Record<string, string> = {
  running: "Fondo facile",
  cycling: "Pedalata facile",
  swimming: "Nuotata facile",
  strength_training: "Forza leggera",
};

const EASY_MINUTES = 40;

function easySession(session: TrainingSession): TrainingSession {
  return {
    ...session,
    title: EASY_TITLE[session.sport] ?? "Seduta leggera",
    // What it replaced, kept in the file: the plan should still show what today was
    // supposed to be, or a week later nobody can tell a swapped day from a written one.
    description: `al posto di "${session.title}", giornata storta`,
    steps: [{ type: "interval", duration_type: "time", duration_value: EASY_MINUTES }],
  };
}

/** Screen "Stato del giorno": the verdict, the measurements behind it, and -- when the
 * answer is not "do the session as written" -- one tap to apply the alternative.
 *
 * It proposes; it never rewrites the plan on its own. The button below is the only
 * thing that changes anything, which is also why every signal is shown with its figure:
 * the user is the one deciding.
 */
export default function DayStatePage() {
  const animate = useMountOnce("body-stato");
  const router = useRouter();
  const access = useCalendarAccess();
  const bodyQuery = useBodyToday();
  const todayKey = toDateKey(new Date());
  const [applied, setApplied] = useState<string | null>(null);

  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWeekWorkouts(new Date(), liveMode);
  const sessions = useMemo(
    () => (access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? [])),
    [access.plan, workoutsQuery.data]
  );

  const todayIndex = sessions.findIndex((s) => s.date === todayKey);
  const todaySession = todayIndex >= 0 ? sessions[todayIndex] : null;
  const goal = access.plan?.goal ?? null;

  const ready = access.ready && (!liveMode || !workoutsQuery.isPending);
  const verdictQuery = useDayVerdict(todaySession, goal, ready);
  const narrativeQuery = useDayVerdictNarrative(todaySession, goal, ready && !!verdictQuery.data);
  const updateSession = useUpdateSession();

  const verdict = verdictQuery.data;

  /** The three edits the alternatives can ask for. Only a plan session can be rewritten
   * -- a live Garmin calendar entry has no steps here to soften, so that case offers
   * the advice without the button. */
  function applyAlternative(v: DayVerdict) {
    if (!v.alternative || todayIndex < 0) return;
    if (v.alternative.kind === "reschedule") {
      updateSession(todayIndex, (s) => ({ ...s, date: shiftDateKey(s.date, 1) }));
    } else if (v.alternative.kind === "soften") {
      updateSession(todayIndex, softenSession);
    } else if (v.alternative.kind === "easy") {
      updateSession(todayIndex, easySession);
    } else if (v.alternative.kind === "rest") {
      // A rest day is the absence of a session, so the session moves out of today
      // rather than being deleted: nothing is lost, it is just not today's problem.
      updateSession(todayIndex, (s) => ({ ...s, date: shiftDateKey(s.date, 1) }));
    }
    setApplied(v.alternative.kind);
  }

  const header = STATE_HEADER[verdict?.state ?? "sconosciuto"] ?? STATE_HEADER.sconosciuto;

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/today" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>Stato del giorno</h1>
        {goal && (
          <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-70)", background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "6px 12px" }}>
            {countdownLabel(goal)}
          </span>
        )}
      </div>

      {verdictQuery.isPending || !verdict ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={150} radius={27} />
          <Skeleton height={90} radius={22} />
        </div>
      ) : (
        <>
          <SlideUp
            active={animate}
            delayMs={80}
            style={{ background: header.background, color: header.color, borderRadius: "var(--radius-card-lg)", padding: 22, marginTop: 18 }}
          >
            <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", opacity: 0.7, margin: 0 }}>
              {header.overline}
            </p>
            <p style={{ font: "600 26px/1.15 var(--font-outfit)", letterSpacing: "-.02em", margin: "10px 0 0" }}>{verdict.headline}</p>
            <p className="font-serif-italic" style={{ fontSize: 16, lineHeight: 1.35, margin: "12px 0 0", opacity: 0.92 }}>
              {narrativeQuery.data?.text ?? "Guarda i segnali qui sotto: sono le misure di stanotte, confrontate con le tue."}
            </p>
          </SlideUp>

          {!verdict.has_data && (
            <SlideUp active={animate} delayMs={140} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>Stanotte non ho letture</p>
              <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.35 }}>
                Senza sonno e HRV non ho niente da leggere, e preferisco dirtelo invece di
                inventarmi un giudizio. Se hai indossato l&apos;orologio, sincronizzalo e torna qui.
              </p>
            </SlideUp>
          )}

          {verdict.signals.length > 0 && <SignalList signals={verdict.signals} animate={animate} />}

          {verdict.has_data && verdict.signals.length === 0 && (
            <SlideUp active={animate} delayMs={160} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>Nessun segnale fuori posto</p>
              <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.35 }}>
                Sonno, HRV, frequenza a riposo e stress sono tutti dentro le tue medie.
              </p>
            </SlideUp>
          )}

          <SessionBlock verdict={verdict} animate={animate} />

          {verdict.alternative && (
            <SlideUp active={animate} delayMs={260} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 12 }}>
              <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
                in alternativa
              </p>
              <p style={{ font: "600 17px/1.25 var(--font-outfit)", margin: "8px 0 0" }}>{verdict.alternative.label}</p>
              <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.35 }}>
                {verdict.alternative.detail}
              </p>
              {verdict.phase && (
                <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)", margin: "8px 0 0" }}>
                  {goal ? `${goalTitle(goal)} ${countdownLabel(goal)} · ${verdict.phase}` : verdict.phase}
                </p>
              )}

              {applied ? (
                <p style={{ background: "var(--verde)", color: "var(--verde-testo)", borderRadius: "var(--radius-card)", padding: "12px 14px", fontSize: 13.5, fontWeight: 600, margin: "14px 0 0" }}>
                  Fatto, il piano è aggiornato.
                </p>
              ) : todayIndex >= 0 ? (
                <button
                  type="button"
                  onClick={() => applyAlternative(verdict)}
                  className="press-soft"
                  style={{ width: "100%", background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "15px 22px", marginTop: 16, fontSize: 15, fontWeight: 600, cursor: "pointer" }}
                >
                  Applica al piano
                </button>
              ) : (
                <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "14px 0 0", lineHeight: 1.4 }}>
                  Questa seduta arriva dal calendario Garmin, non dal piano: la modifica te la
                  lascio fare da Settimana.
                </p>
              )}
            </SlideUp>
          )}

          {/* The alternative is chosen by phase -- base, build, peak, taper -- and with
              no race there is no phase, so it falls back to a generic easy day. Saying
              so where the weaker proposal is, rather than as a banner somewhere else. */}
          {!goal && access.plan && (
            <SlideUp active={animate} delayMs={300} style={{ marginTop: 12 }}>
              <Link
                href="/settings/goal"
                className="press-soft"
                style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--sabbia)", border: "1px dashed var(--inchiostro-35)", borderRadius: "var(--radius-card)", padding: "15px 18px", textDecoration: "none", color: "inherit" }}
              >
                <div style={{ flex: 1 }}>
                  <p style={{ font: "600 15.5px/1.2 var(--font-outfit)", margin: 0 }}>Non so per che gara ti alleni</p>
                  <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.35 }}>
                    Con una data e una distanza so a che punto della preparazione sei, e l&apos;alternativa
                    che ti propongo cambia di conseguenza.
                  </p>
                </div>
                <span aria-hidden="true" className="anim-chev" style={{ flex: "none", fontSize: 18 }}>→</span>
              </Link>
            </SlideUp>
          )}

          <p style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "18px 0 0", lineHeight: 1.45 }}>
            Ogni numero qui sopra è una misura del tuo orologio confrontata con la tua media:
            puoi rifarlo a mano. Orientamento sportivo generale, non un consiglio clinico.
          </p>

          {bodyQuery.data && (
            <button
              type="button"
              onClick={() => router.push("/body")}
              className="press-soft"
              style={{ width: "100%", background: "var(--sabbia)", border: "none", borderRadius: "var(--radius-pill)", padding: "14px 22px", marginTop: 14, fontSize: 14.5, fontWeight: 600, cursor: "pointer", color: "var(--inchiostro)" }}
            >
              Vedi tutti i dati del corpo
            </button>
          )}
        </>
      )}
    </div>
  );
}

function SignalList({ signals, animate }: { signals: DaySignal[]; animate: boolean }) {
  return (
    <div style={{ marginTop: 18 }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
        Cosa ho letto
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {signals.map((signal, i) => {
          const style = SEVERITY_STYLE[signal.severity] ?? SEVERITY_STYLE.info;
          return (
            <SlideUp
              key={signal.key}
              active={animate}
              delayMs={160 + i * 50}
              row
              style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", padding: "13px 16px" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <p style={{ fontWeight: 600, fontSize: 14.5, margin: 0 }}>{signal.label}</p>
                <span style={{ background: style.background, color: style.color, borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 10.5, fontWeight: 700, flex: "none" }}>
                  {style.label}
                </span>
              </div>
              <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "5px 0 0" }}>{signal.detail}</p>
            </SlideUp>
          );
        })}
      </div>
    </div>
  );
}

const DEMAND_LABEL: Record<string, string> = {
  riposo: "riposo",
  facile: "facile",
  medio: "impegno medio",
  duro: "seduta di qualità",
};

function SessionBlock({ verdict, animate }: { verdict: DayVerdict; animate: boolean }) {
  return (
    <SlideUp active={animate} delayMs={220} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
      <p className="font-mono" style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
        oggi in programma
      </p>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 7 }}>
        <p style={{ font: "600 16px/1.25 var(--font-outfit)", margin: 0 }}>
          {verdict.session_title ?? "Niente, è un giorno di riposo"}
        </p>
        {verdict.session_demand && (
          <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", flex: "none" }}>
            {DEMAND_LABEL[verdict.session_demand] ?? verdict.session_demand}
          </span>
        )}
      </div>
    </SlideUp>
  );
}
