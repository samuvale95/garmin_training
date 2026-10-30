"use client";

import { useEffect, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ContextLink } from "@/components/ContextLink";
import { WorkspaceHeading } from "@/components/Workspace";
import { Illustration } from "@/components/Illustration";
import { CheckInCard } from "@/components/CheckInCard";
import { AdaptationCard } from "@/components/AdaptationCard";
import { NowMealCard } from "@/components/NowMealCard";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Skeleton } from "@/components/motion/primitives";
import { CheckIcon, UtensilsIcon } from "@/components/Icons";
import { Badge, DateLead, EmptyState, Notice, RowLink, Section, SectionLink, SportMark, Stat, WeekRhythm } from "@/components/ui";
import { currentMoment, useClockMinutes } from "@/lib/fuelMoment";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import {
  useActivities,
  useBodyToday,
  useCheckAdaptation,
  useCheckIns,
  useDayVerdict,
  useFuelStatus,
  useFuelTargets,
  usePlanDiff,
  useRaceGoal,
  useRefreshServerData,
  useStravaActivityMatches,
  useStravaStatus,
  useWeekWorkouts,
} from "@/lib/queries";
import { useWatchSyncStatus } from "@/lib/watchSync";
import { usePassoStore } from "@/lib/store";
import { useTrainingSlot } from "@/lib/trainingHabits";
import { EVENING_MINUTES, useDayFocus } from "@/lib/dayFocus";
import {
  classifySession,
  effectiveSteps,
  effectiveTitle,
  sessionDistanceKm,
  sessionDurationMinutes,
  shiftDateKey,
  toDateKey,
  weekBounds,
  workoutsToSessions,
  type DisplaySession,
} from "@/lib/sessionVisuals";
import { capitalize, formatFullDate, formatMinutes, groupSteps, relativeDayLabel, stepGroupLine } from "@/lib/format";
import { countdownLabel, goalTitle } from "@/lib/raceGoal";
import { useScreenReady } from "@/lib/useScreenReady";
import type { DayVerdict, ScheduledWorkout, TrainingSession } from "@/lib/types";

const VERDICT_BADGE: Record<string, { tone: "ok" | "warn" | "danger"; label: string }> = {
  pronto: { tone: "ok", label: "Corpo pronto" },
  cauto: { tone: "warn", label: "Con cautela" },
  scarico: { tone: "danger", label: "Corpo scarico" },
};

/** Oggi answers one question -- what do I do now -- in a fixed order: the next session,
 * the other sessions of the day, how the body is, the next meal, then tomorrow. The
 * order never shuffles with the clock; only the content of each block follows it. */
export function TodayView() {
  const router = useRouter();
  const access = useCalendarAccess({ redirectWhenEmpty: false });
  const animate = useMountOnce("today");
  const today = new Date();
  const todayKey = toDateKey(today);
  const { start, end } = weekBounds(today);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWeekWorkouts(today, liveMode);
  const diffQuery = usePlanDiff(access.plan?.sessions ?? null);
  const bodyQuery = useBodyToday();

  const stravaStatus = useStravaStatus();
  const planSessionsThisWeek = access.plan ? access.plan.sessions.filter((s) => s.date >= startKey && s.date <= endKey) : [];
  const stravaEnabled = !!access.plan && !!stravaStatus.data?.connected && planSessionsThisWeek.length > 0;
  const stravaMatches = useStravaActivityMatches(planSessionsThisWeek, stravaEnabled);

  const avvisamiSeIlCorpoNonRegge = usePassoStore((s) => s.prefs.avvisamiSeIlCorpoNonRegge);
  const { goal } = useRaceGoal(access.plan, access.ready);
  const watchSync = useWatchSyncStatus();

  const verdictSession = access.plan?.sessions.find((s) => s.date === todayKey) ?? null;
  const wantsVerdict = avvisamiSeIlCorpoNonRegge && !watchSync.blocking && access.ready;
  const verdictQuery = useDayVerdict(verdictSession, goal, wantsVerdict);

  // The check-in: after training today, or the next morning for yesterday's session if
  // it went unanswered (see CheckInCard). "Trained" is a completed activity when the
  // watch is connected, a planned session otherwise.
  const yesterdayKey = shiftDateKey(todayKey, -1);
  const recentActivities = useActivities(yesterdayKey, todayKey, access.ready && access.garminConnected);
  const recentCheckIns = useCheckIns(yesterdayKey, todayKey, access.ready);
  const trainedOn = (day: string) =>
    access.garminConnected
      ? (recentActivities.data?.activities ?? []).some((a) => a.date === day)
      : !!access.plan?.sessions.some((s) => s.date === day);
  const checkInOn = (day: string) => recentCheckIns.data?.checkins.find((c) => c.date === day) ?? null;
  const checkInReady = recentCheckIns.isSuccess && (!access.garminConnected || recentActivities.isSuccess);
  const checkInDay: "oggi" | "ieri" | null = !checkInReady
    ? null
    : trainedOn(todayKey) || checkInOn(todayKey)
      ? "oggi"
      : trainedOn(yesterdayKey) && !checkInOn(yesterdayKey)
        ? "ieri"
        : null;

  // Adaptation: once a day from here (and after every check-in). Only with a plan.
  const checkAdaptation = useCheckAdaptation();
  const hasPlan = !!access.plan;
  useEffect(() => {
    if (access.ready && hasPlan) checkAdaptation();
  }, [access.ready, hasPlan, checkAdaptation]);

  const openMeal = () => router.push(`/nutrition?date=${todayKey}&view=diary&log=1&from=%2Ftoday`);
  const planOrLiveSessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const training = useTrainingSlot(todayKey, access.ready);
  const fuelStatus = useFuelStatus(todayKey, manualWeight?.weightKg, access.ready);
  const fuelTargets = useFuelTargets(todayKey, planOrLiveSessions, manualWeight?.weightKg, access.ready && training.ready, training.slot);
  const refreshMutation = useRefreshServerData();
  const nowMinutes = useClockMinutes();
  const { focus } = useDayFocus({
    todayKey,
    sessionToday: planOrLiveSessions.some((s) => s.date === todayKey),
    training,
    garminConnected: access.garminConnected,
    enabled: access.ready,
  });
  useScreenReady(access.ready && !(liveMode && workoutsQuery.isPending), "/today");

  const heading = (
    <WorkspaceHeading title="Oggi" description={capitalize(formatFullDate(todayKey))}>
      <button className="btn" onClick={openMeal} data-track="today.registra-cibo-o-snack">
        <UtensilsIcon size={16} aria-hidden="true" />
        Registra pasto
      </button>
    </WorkspaceHeading>
  );

  if (!access.ready) {
    // No date yet: this branch is also the prerendered HTML, and the build day is not
    // today. The date appears with the data, on the client.
    return (
      <div className="page">
        <WorkspaceHeading title="Oggi" />
        <Skeleton height={260} radius={22} />
      </div>
    );
  }

  if (!access.plan && !access.garminConnected) {
    return (
      <div className="page" data-width="reading">
        {heading}
        <EmptyState
          title="Il primo passo è il tuo programma"
          actions={
            <>
              <Link className="btn" data-variant="primary" href="/week/programs" data-track="today.empty-programs">Crea o importa un programma</Link>
              <Link className="btn" href="/connect-garmin" data-track="today.empty-connect">Collega Garmin</Link>
            </>
          }
        >
          Crea o importa gli allenamenti, oppure collega Garmin per ritrovare il calendario che hai già.
        </EmptyState>
      </div>
    );
  }

  const sessions: DisplaySession[] = access.plan ? access.plan.sessions : workoutsQuery.data?.workouts ?? [];
  const todaySessions = sessions.filter((s) => s.date === todayKey);
  const nextSession = sessions.filter((s) => s.date > todayKey).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const evening = nowMinutes != null && nowMinutes >= EVENING_MINUTES;
  const lookAhead = focus === "domani" || (focus === "recupero" && evening);
  const heroSession = lookAhead ? nextSession ?? todaySessions[0] ?? null : todaySessions[0] ?? nextSession;
  const otherToday = todaySessions.filter((s) => s !== heroSession);

  const hrefFor = (session: DisplaySession) => {
    const planned = access.plan?.sessions.find((item) => item === session) as TrainingSession | undefined;
    if (planned?.id) return `/session/${encodeURIComponent(planned.id)}`;
    const workout = workoutsQuery.data?.workouts.find((item) => item === session) as ScheduledWorkout | undefined;
    return workout ? `/workout/${workout.scheduled_workout_id}?date=${workout.date}` : "/week";
  };
  const doneOn = (session: DisplaySession) =>
    !!stravaMatches.data?.matches[session.date]?.matched || (session.date === todayKey && todaySessions.length === 1 && trainedOn(todayKey));

  const pendingChanges = (diffQuery.data?.to_create?.length ?? 0) + (diffQuery.data?.changed?.length ?? 0);
  const mealMoment = fuelTargets.data ? currentMoment(fuelTargets.data, nowMinutes) : null;
  const readiness = bodyQuery.data?.readiness_score;
  const sleepMinutes = bodyQuery.data?.sleep?.total_minutes;
  const carbLogged = fuelStatus.data?.totals?.carb_g;
  const carbTarget = fuelTargets.data?.today?.carb_g;

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const doneKeys = new Set(Object.entries(stravaMatches.data?.matches ?? {}).filter(([, m]) => m.matched).map(([k]) => k));
  if (trainedOn(todayKey)) doneKeys.add(todayKey);

  const tomorrowKey = shiftDateKey(todayKey, 1);
  const tomorrowSessions = sessions.filter((s) => s.date === tomorrowKey);

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div className="page">
        {heading}

        {watchSync.blocking && (
          <div style={{ marginBottom: 16 }}>
            <Notice tone="warn" title="Alcuni dati dell’orologio non sono aggiornati">
              Il piano resta consultabile. <Link href="/watch-sync?from=%2Ftoday" data-track="today.stale-sync">Come aggiornarli</Link>
            </Notice>
          </div>
        )}

        <div className="split">
          <div className="stack-lg">
            <div className="stack">
              <SessionHero
                session={heroSession}
                isToday={heroSession?.date === todayKey}
                href={heroSession ? hrefFor(heroSession) : "/week"}
                done={heroSession ? doneOn(heroSession) : false}
                verdict={heroSession?.date === todayKey ? verdictQuery.data ?? null : null}
                today={today}
                animate={animate}
              />
              {hasPlan && <AdaptationCard animate={animate} delayMs={0} />}
            </div>

            {otherToday.length > 0 && (
              <Section title={`Altre sedute di oggi`} id="today-others">
                <ul className="list">
                  {otherToday.map((session, i) => {
                    const minutes = Math.round(sessionDurationMinutes(session));
                    return (
                      <li key={i}>
                        <RowLink
                          href={hrefFor(session)}
                          from="/today"
                          track="today.day-session"
                          lead={<SportMark session={session} />}
                          title={effectiveTitle(session)}
                          meta={[classifySession(session).label, minutes > 0 ? formatMinutes(minutes) : null].filter(Boolean).join(" · ")}
                          end={doneOn(session) ? <Badge tone="ok"><CheckIcon size={12} aria-hidden="true" />Svolto</Badge> : <Badge>Programmato</Badge>}
                        />
                      </li>
                    );
                  })}
                </ul>
              </Section>
            )}

            {checkInDay && (
              <CheckInCard
                key={checkInDay === "oggi" ? todayKey : yesterdayKey}
                date={checkInDay === "oggi" ? todayKey : yesterdayKey}
                dayLabel={checkInDay}
                trained={trainedOn(checkInDay === "oggi" ? todayKey : yesterdayKey)}
                existing={checkInOn(checkInDay === "oggi" ? todayKey : yesterdayKey)}
                animate={animate}
                delayMs={0}
              />
            )}

            {liveMode ? (
              <Notice tone="neutral" title="Stai vedendo il calendario Garmin" action={<Link className="btn" data-size="sm" href="/week/programs/new?source=import" data-track="today.import">Importa un programma</Link>}>
                Importa o crea un programma per vedere fasi, ritmi e obiettivo di ogni seduta.
              </Notice>
            ) : pendingChanges > 0 ? (
              <ul className="list">
                <li>
                  <RowLink
                    href="/diff"
                    from="/today"
                    track="today.diff"
                    title={`${pendingChanges} ${pendingChanges === 1 ? "modifica da inviare" : "modifiche da inviare"} a Garmin`}
                    meta="Salvate nell’app, non ancora sull’orologio. Controlla prima di inviare."
                    end={<Badge tone="warn">Da inviare</Badge>}
                  />
                </li>
              </ul>
            ) : null}
          </div>

          <aside className="stack-lg" aria-label="Recupero, alimentazione e prossimi giorni">
            <Section title="Come stai" id="today-body" action={<SectionLink href="/body" track="today.body">Recupero</SectionLink>}>
              <div className="card">
                <div className="stats">
                  <Stat value={readiness != null ? Math.round(readiness) : "—"} unit={readiness != null ? "/100" : undefined} label="Prontezza" note={readiness == null ? "Non disponibile" : undefined} />
                  <Stat value={sleepMinutes != null ? formatMinutes(sleepMinutes) : "—"} label="Sonno" note={sleepMinutes == null ? "Non disponibile" : undefined} />
                </div>
              </div>
            </Section>

            <Section title="Alimentazione" id="today-fuel" action={<SectionLink href={`/nutrition?date=${todayKey}`} track="today.nutrition">Nutrizione</SectionLink>}>
              <div className="stack">
                {fuelTargets.data && mealMoment ? (
                  <NowMealCard fuel={fuelTargets.data} moment={mealMoment} onLog={openMeal} animate={animate} delayMs={0} />
                ) : fuelTargets.isPending && access.ready ? (
                  <Skeleton height={96} radius={16} />
                ) : (
                  <ul className="list">
                    <li>
                      <RowLink href={`/nutrition?date=${todayKey}&view=diary`} track="today.nutrition-fallback" title="Diario di oggi" meta="Le indicazioni non sono disponibili ora: puoi comunque registrare i pasti." />
                    </li>
                  </ul>
                )}
                {carbTarget && (
                  <p className="muted" style={{ margin: 0, fontSize: "var(--text-sm)" }}>
                    Carboidrati registrati oggi: <span className="figure">{carbLogged != null ? `${Math.round(carbLogged)} g` : "nessuna registrazione"}</span> su{" "}
                    <span className="figure">{carbTarget[0]}–{carbTarget[1]} g</span> indicati.
                  </p>
                )}
              </div>
            </Section>

            <Section title="Questa settimana" id="today-week" action={<SectionLink href="/week" track="today.open-plan">Piano</SectionLink>}>
              <div className="card">
                <WeekRhythm
                  days={weekDays}
                  sessions={sessions.filter((s) => s.date >= startKey && s.date <= endKey)}
                  todayKey={todayKey}
                  doneKeys={doneKeys}
                  hrefFor={(key) => `/week?date=${key}`}
                  label="Sedute della settimana, un giorno per colonna"
                />
              </div>
              {tomorrowSessions.length > 0 && heroSession?.date !== tomorrowKey && (
                <ul className="list" style={{ marginTop: 12 }}>
                  {tomorrowSessions.map((session, i) => (
                    <li key={i}>
                      <RowLink
                        href={hrefFor(session)}
                        from="/today"
                        track="today.tomorrow"
                        lead={<DateLead date={session.date} />}
                        title={`Domani: ${effectiveTitle(session)}`}
                        meta={[classifySession(session).label, sessionDurationMinutes(session) > 0 ? formatMinutes(sessionDurationMinutes(session)) : null].filter(Boolean).join(" · ")}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            {goal && (
              <ul className="list">
                <li>
                  <RowLink href="/week/goals" track="today.goal" title={goalTitle(goal)} meta={`Obiettivo · ${countdownLabel(goal)}`} />
                </li>
              </ul>
            )}
          </aside>
        </div>
      </div>
    </PullToRefresh>
  );
}

/** The one dominant surface of Oggi: what is planned next, how long, what it asks, and
 * the single action that opens it. A rest day says so and dates the next session. */
function SessionHero({
  session,
  isToday,
  href,
  done,
  verdict,
  today,
  animate,
}: {
  session: DisplaySession | null;
  isToday: boolean;
  href: string;
  done: boolean;
  verdict: DayVerdict | null;
  today: Date;
  animate: boolean;
}) {
  if (!session) {
    return (
      <article className="hero">
        <p className="hero-kicker">Nessuna seduta in programma</p>
        <h2 className="hero-title">Giorno di riposo</h2>
        <p className="hero-text">Non ci sono allenamenti nei prossimi giorni del calendario. Puoi aggiungerne uno o costruire un programma.</p>
        <div className="hero-actions">
          <Link className="btn" data-variant="primary" href="/week/new?from=%2Ftoday" data-track="today.add-session">Aggiungi allenamento</Link>
          <Link className="btn" href="/week/programs" data-track="today.programs">Programmi</Link>
        </div>
        <div className="hero-art"><Illustration name="riposo" width={150} height={160} position="relative" active={animate} /></div>
      </article>
    );
  }

  const visual = classifySession(session);
  const minutes = Math.round(sessionDurationMinutes(session));
  const km = sessionDistanceKm(session);
  const steps = effectiveSteps(session);
  const groups = steps.length > 0 ? groupSteps(steps) : [];
  const main = groups.find((g) => g.kind === "interval") ?? null;
  const badge = verdict && verdict.has_data ? VERDICT_BADGE[verdict.state] : undefined;
  const when = isToday ? "Oggi" : capitalize(relativeDayLabel(session.date, today));
  const restToday = !isToday;

  return (
    <article className="hero" data-sport style={{ "--sport": visual.accent } as CSSProperties} aria-labelledby="today-hero-title">
      <div className="hero-kicker">
        <span className="sport-tag" style={{ "--sport": visual.accent } as CSSProperties}>
          <SportMark session={session} />
          {visual.label}
        </span>
        <span aria-hidden="true">·</span>
        <span>{restToday ? `${when}, ${formatFullDate(session.date)}` : when}</span>
        {done ? <Badge tone="ok"><CheckIcon size={12} aria-hidden="true" />Svolto</Badge> : null}
        {session.is_short_active && <Badge tone="accent">Versione breve</Badge>}
        {badge && (
          <Link href="/body/stato?from=%2Ftoday" data-track="today.verdict" style={{ textDecoration: "none" }}>
            <Badge tone={badge.tone}>{badge.label}</Badge>
          </Link>
        )}
      </div>
      {restToday && <p className="hero-text" style={{ marginTop: 6 }}>Oggi è un giorno di riposo. La prossima seduta:</p>}
      <h2 className="hero-title" id="today-hero-title" style={{ paddingRight: 0 }}>{effectiveTitle(session)}</h2>

      <div className="hero-figures">
        {minutes > 0 && <Stat value={formatMinutes(minutes)} label="Durata prevista" />}
        {km > 0 && <Stat value={km.toLocaleString("it-IT", { maximumFractionDigits: 1 })} unit="km" label="Distanza stimata" />}
        {main && <Stat value={<span style={{ fontSize: "var(--text-lg)" }}>{stepGroupLine(main)}</span>} label="Parte principale" />}
      </div>

      {verdict?.headline && badge && badge.tone !== "ok" && <p className="hero-text">{verdict.headline}</p>}

      <div className="hero-actions">
        <ContextLink className="btn" data-variant="primary" href={href} from="/today" data-track="today.open-session">
          {done ? "Apri il resoconto" : "Apri allenamento"}
        </ContextLink>
      </div>
      {visual.illustration && (
        <div className="hero-art" aria-hidden="true">
          <Illustration name={visual.illustration} width={150} height={160} position="relative" active={animate} priority />
        </div>
      )}
    </article>
  );
}
