"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { DayStateCard } from "@/components/DayStateCard";
import { CheckInCard } from "@/components/CheckInCard";
import { AdaptationCard } from "@/components/AdaptationCard";
import { Mascot, Tokens } from "@/components/ProgressBits";
import { RaceGoalCard } from "@/components/RaceGoalCard";
import { TiltCard } from "@/components/motion/TiltCard";
import { BarGrow, PulseRing, SlideUp, StatusDot, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import {
  GOAL_LOOKAHEAD_DAYS,
  useActivities,
  useBodyToday,
  useCheckAdaptation,
  useCheckIns,
  useProgress,
  useWeekSummary,
  useDayVerdict,
  useDayVerdictNarrative,
  usePlanDiff,
  useRaceGoal,
  useStravaActivityMatches,
  useStravaStatus,
  useWeekWorkouts,
  useWorkouts,
} from "@/lib/queries";
import { useWatchSyncStatus } from "@/lib/watchSync";
import { SkeletonTodayHero } from "@/components/skeletons";
import { usePassoStore } from "@/lib/store";
import { classifySession, sessionDistanceKm, shiftDateKey, toDateKey, weekBounds, type DisplaySession } from "@/lib/sessionVisuals";
import { capitalize, formatFullDate, groupSteps, numberToItalianWords, relativeDayLabel, stepGroupLine } from "@/lib/format";

export default function TodayPage() {
  const router = useRouter();
  const access = useCalendarAccess();
  const animate = useMountOnce("today");
  const today = new Date();
  const todayKey = toDateKey(today);
  const { start, end } = weekBounds(today);
  const liveMode = !access.plan && access.garminConnected;
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const workoutsQuery = useWeekWorkouts(today, liveMode);
  // Same cache entry /diff uses, so tapping through to it costs no new request.
  const diffQuery = usePlanDiff(access.plan?.sessions ?? null);
  const bodyQuery = useBodyToday();

  // "Svolto" indicators for the hero card + rest-of-week list, same batch pattern as
  // Week -- one request for the whole visible week, not one per session.
  const stravaStatus = useStravaStatus();
  const planSessionsThisWeek = access.plan ? access.plan.sessions.filter((s) => s.date >= startKey && s.date <= endKey) : [];
  const stravaEnabled = !!access.plan && !!stravaStatus.data?.connected && planSessionsThisWeek.length > 0;
  const stravaMatches = useStravaActivityMatches(planSessionsThisWeek, stravaEnabled);

  const avvisamiSeIlCorpoNonRegge = usePassoStore((s) => s.prefs.avvisamiSeIlCorpoNonRegge);

  // The race this account trains for, in the plan or standalone -- see useRaceGoal.
  // Without a plan there is no bounded "rest of the calendar" to count, so a live
  // lookahead stands in for it, but only while there's no goal yet to ask the prompt
  // about; once one is set, the goal screen reads the calendar bounded by the race date.
  const { goal } = useRaceGoal(access.plan, access.ready);
  const liveLookahead = useWorkouts(todayKey, shiftDateKey(todayKey, GOAL_LOOKAHEAD_DAYS), liveMode && !goal);

  // "19 L'orologio non ha ancora parlato" replaces Today when the watch hasn't pushed
  // to Garmin's cloud in over 24h: with no overnight data there is nothing to interpret,
  // and half this screen would be em dashes.
  const watchSync = useWatchSyncStatus();
  useEffect(() => {
    if (watchSync.blocking) router.replace("/watch-sync");
  }, [watchSync.blocking, router]);

  // Today's state, and what it says about today's session. It sits on this screen as a
  // card rather than replacing it: the old behaviour hijacked Oggi with a full-screen
  // "il corpo dice no" the moment readiness dipped, which is a lot of authority for one
  // low number -- and it only ever looked at *tomorrow*. The card says the same thing
  // where the user is already looking, and the verdict screen is one tap behind it.
  // The "avvisami se il corpo non regge" preference now decides whether it appears.
  const verdictSession = access.plan?.sessions.find((s) => s.date === todayKey) ?? null;
  const wantsVerdict = avvisamiSeIlCorpoNonRegge && !watchSync.blocking && access.ready;
  const verdictQuery = useDayVerdict(verdictSession, goal, wantsVerdict);
  const verdictNarrative = useDayVerdictNarrative(verdictSession, goal, wantsVerdict && !!verdictQuery.data);

  // The check-in: asked after training today, or the next morning for yesterday's
  // session if it went unanswered (see `CheckInCard`). "Trained" is a completed activity
  // when the watch is connected, a planned session otherwise.
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

  // Monday to Wednesday, the week just finished: the server's default week is exactly
  // that, so no date is sent.
  const earlyInWeek = (today.getDay() + 6) % 7 <= 2;
  const lastWeek = useWeekSummary(null, access.ready && earlyInWeek);
  const progress = useProgress(access.ready);

  // Adaptation: once a day from here (and after every check-in, see CheckInCard). Only
  // with a plan -- there is nothing to adapt on a Garmin-calendar-only account.
  const checkAdaptation = useCheckAdaptation();
  const hasPlan = !!access.plan;
  useEffect(() => {
    if (access.ready && hasPlan) checkAdaptation();
  }, [access.ready, hasPlan, checkAdaptation]);

  // Until we know whether there's a plan or a live Garmin connection there is nothing
  // real to show -- but "nothing real" used to mean `return null`, i.e. an empty screen
  // for as long as the Garmin status check took. Render the header and the shapes.
  if (!access.ready || (!access.plan && !access.garminConnected)) {
    return (
      <div style={{ padding: "22px 20px 12px" }}>
        <TodayHeader />
        <div style={{ marginTop: 18 }}>
          <WordIn active={animate} style={{ font: "600 34px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>Il tuo oggi</WordIn>
        </div>
        <div style={{ marginTop: 16 }}>
          <SkeletonTodayHero />
        </div>
      </div>
    );
  }

  const sessions: DisplaySession[] = access.plan ? access.plan.sessions : workoutsQuery.data?.workouts ?? [];

  const todaySession = sessions.find((s) => s.date === todayKey) ?? null;
  const weekSessions = sessions.filter((s) => s.date >= toDateKey(start) && s.date <= toDateKey(end));
  const weekKm = weekSessions.reduce((sum, s) => sum + sessionDistanceKm(s), 0);

  const restOfWeek = sessions
    .filter((s) => s.date > todayKey && s.date <= toDateKey(end))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 5);
  const remainingKm = restOfWeek.reduce((sum, s) => sum + sessionDistanceKm(s), 0);

  // When today is a rest day, preview the next upcoming session instead of just
  // saying "nothing today" -- matches the design's "domani · martedì 11" hero card.
  const heroSession = todaySession ?? sessions.filter((s) => s.date > todayKey).sort((a, b) => a.date.localeCompare(b.date))[0] ?? null;
  const heroGroups = heroSession?.steps ? groupSteps(heroSession.steps).filter((g) => g.kind === "interval" || g.kind === "warmup" || g.kind === "cooldown") : [];
  const heroMainGroup = heroGroups.find((g) => g.kind === "interval") ?? heroGroups[0] ?? null;

  const heroMatch = heroSession ? stravaMatches.data?.matches[heroSession.date] : undefined;
  const heroPlanSession = access.plan?.sessions.find((session) => session === heroSession);
  const heroWorkout = workoutsQuery.data?.workouts.find((session) => session === heroSession);
  const heroHref = heroPlanSession?.id
    ? `/session/${encodeURIComponent(heroPlanSession.id)}`
    : heroWorkout
      ? `/workout/${heroWorkout.scheduled_workout_id}?date=${heroWorkout.date}`
      : "/week";


  const pendingChanges = (diffQuery.data?.to_create.length ?? 0) + (diffQuery.data?.changed.length ?? 0);
  const readiness = bodyQuery.data?.readiness_score;
  const sleepMinutes = bodyQuery.data?.sleep?.total_minutes;

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <TodayHeader />

      <header className="today-intro">
        <h1>Il tuo oggi</h1>
        <p>{capitalize(formatFullDate(todayKey))} · Un passo alla volta.</p>
      </header>

      <SlideUp active={animate} delayMs={100}>
        <TiltCard
          maxTilt={5}
          className="today-hero"
          style={{
            background: heroSession ? "var(--corallo)" : "var(--sabbia)",
            color: heroSession ? "var(--corallo-testo)" : "var(--inchiostro)",
            borderRadius: "var(--radius-card-lg)",
            padding: 20,
            marginTop: 16,
            minHeight: 210,
            position: "relative",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          <div className="today-hero-copy">
            {heroSession ? (
              <>
                <p className="font-mono" style={{ fontSize: 12, opacity: 0.7, margin: "0 0 6px" }}>
                  {relativeDayLabel(heroSession.date, today)} · {formatFullDate(heroSession.date)}
                </p>
                <p style={{ font: "600 22px/1.15 var(--font-outfit)", margin: "0 0 8px", maxWidth: 200 }}>{heroSession.title}</p>
                {heroMainGroup && (
                  <p className="font-mono" style={{ fontSize: 13, opacity: 0.85, margin: 0, maxWidth: 200 }}>{stepGroupLine(heroMainGroup)}</p>
                )}
                {heroMatch?.matched && heroMatch.distance_km != null && (
                  <p className="font-mono" style={{ fontSize: 12, opacity: 0.75, margin: "6px 0 0", maxWidth: 200 }}>
                    svolto {heroMatch.distance_km.toFixed(1)} km
                  </p>
                )}
              </>
            ) : (
              <p className="font-serif-italic" style={{ fontSize: 17, maxWidth: 200 }}>Oggi è un giorno di riposo. E va bene così.</p>
            )}
          </div>
          <div className="today-hero-art" style={{ transform: "translateZ(26px)" }}>
            <Illustration
              name={heroSession ? classifySession(heroSession).illustration ?? "corsa" : "riposo"}
              width={110}
              height={120}
              right={0}
              bottom={0}
              active={animate}
              delayMs={160}
              breathe
              float
            />
          </div>
          <Link href={heroHref} className="tap-target today-hero-action">
            {heroSession ? "Vedi allenamento" : "Esplora la settimana"}<span aria-hidden="true">↗</span>
          </Link>
        </TiltCard>
      </SlideUp>

      <DayStateCard verdict={verdictQuery.data} narrative={verdictNarrative.data?.text} animate={animate} delayMs={260} />

      {hasPlan && <AdaptationCard animate={animate} delayMs={280} />}

      {checkInDay && (
        <CheckInCard
          key={checkInDay === "oggi" ? todayKey : yesterdayKey}
          date={checkInDay === "oggi" ? todayKey : yesterdayKey}
          dayLabel={checkInDay}
          trained={trainedOn(checkInDay === "oggi" ? todayKey : yesterdayKey)}
          existing={checkInOn(checkInDay === "oggi" ? todayKey : yesterdayKey)}
          animate={animate}
          delayMs={290}
        />
      )}

      {progress.data && (
        <Link href="/progress" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={295} className="press-soft" style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: "10px 14px", marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <Mascot state={progress.data.mascot.state} size={52} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>
                {progress.data.streak} {progress.data.streak === 1 ? "settimana" : "settimane"} di fila
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                <Tokens tokens={progress.data.tokens} max={progress.data.max_tokens} />
                <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)" }}>
                  {progress.data.week_points} punti questa settimana
                </span>
              </div>
            </div>
            <span className="anim-chev" aria-hidden="true">→</span>
          </SlideUp>
        </Link>
      )}

      {earlyInWeek && lastWeek.data && lastWeek.data.done_sessions + lastWeek.data.planned_sessions > 0 && (
        <Link href="/summary" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={300} className="press-soft" style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ font: "500 11.5px var(--font-outfit)", color: "var(--inchiostro-50)", margin: 0 }}>La settimana scorsa</p>
              <p style={{ fontSize: 14, margin: "3px 0 0" }}>{lastWeek.data.headline}</p>
            </div>
            <span className="anim-chev" aria-hidden="true">→</span>
          </SlideUp>
        </Link>
      )}

      {/* Without a race this asks for one -- counted from today forward, plan or live
          calendar alike, so a finished block or a bare Garmin connection doesn't ask. */}
      <RaceGoalCard
        goal={goal}
        upcomingSessions={
          access.plan ? access.plan.sessions.filter((s) => s.date >= todayKey).length : liveLookahead.data?.workouts.length ?? 0
        }
        animate={animate}
        delayMs={320}
      />

      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        <MetricCard
          label="Volume"
          value={liveMode ? "—" : weekKm.toFixed(0)}
          unit={liveMode ? undefined : "km"}
          background="var(--crema-card)"
          delay={340}
          active={animate}
          fraction={liveMode ? 0 : Math.min(1, weekKm / 60)}
          barColor="var(--corallo)"
        />
        <MetricCard
          label="Prontezza"
          value={readiness != null ? String(readiness) : "—"}
          background="var(--verde)"
          color="var(--verde-testo)"
          delay={420}
          active={animate}
          fraction={readiness != null ? readiness / 100 : 0}
          barColor="var(--verde-tratto-scuro)"
        />
        <MetricCard
          label="Sonno"
          value={
            sleepMinutes != null ? (
              <>
                {Math.floor(sleepMinutes / 60)}
                <span style={{ fontSize: 13 }}>h</span>
                {String(sleepMinutes % 60).padStart(2, "0")}
              </>
            ) : (
              "—"
            )
          }
          background="var(--azzurro)"
          color="var(--azzurro-testo)"
          delay={500}
          active={animate}
          fraction={sleepMinutes != null ? sleepMinutes / 540 : 0}
          barColor="var(--azzurro-testo)"
        />
      </div>

      {liveMode ? (
        <Link href="/import" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={580} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <p className="font-serif-italic" style={{ fontSize: 15, margin: 0, flex: 1 }}>
              Questo è il calendario Garmin. Importa un piano per i dettagli di ogni seduta.
            </p>
            <span className="anim-chev" aria-hidden="true">→</span>
          </SlideUp>
        </Link>
      ) : pendingChanges > 0 ? (
        <Link href="/diff" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={580} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <PulseRing size={8} />
            <div style={{ flex: 1 }}>
              <p style={{ fontWeight: 600, fontSize: 15, margin: "0 0 2px" }}>
                {capitalize(numberToItalianWords(pendingChanges))} {pendingChanges === 1 ? "differenza" : "differenze"}
              </p>
              <p className="font-serif-italic" style={{ fontSize: 14, margin: 0 }}>Il file non combacia col calendario.</p>
            </div>
            <span
              aria-hidden="true"
              style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--inchiostro)", color: "var(--crema)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
            >
              →
            </span>
          </SlideUp>
        </Link>
      ) : (
        <SlideUp active={animate} delayMs={580} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px", marginTop: 10 }}>
          <StatusDot kind="active" size={7} />
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>in pari col calendario</span>
        </SlideUp>
      )}

      {/* The list always gets its title -- it's what separates it from the card above.
          Only the total is conditional: Garmin's calendar entries carry no distance, so
          in live mode the km would read "0 km", a wrong statement rather than a missing
          one. */}
      {restOfWeek.length > 0 && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 20, padding: "0 2px 6px" }}>
          <span style={{ font: "500 11.5px var(--font-outfit)", color: "var(--inchiostro-50)" }}>resto della settimana</span>
          {remainingKm > 0 && (
            <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)" }}>{remainingKm.toFixed(1).replace(".0", "")} km</span>
          )}
        </div>
      )}
      <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        {restOfWeek.map((session, i) => {
          const visual = classifySession(session);
          const km = sessionDistanceKm(session);
          const match = stravaMatches.data?.matches[session.date];
          return (
            <SlideUp
              key={`${session.date}-${i}`}
              active={animate}
              delayMs={720 + i * 80}
              row
              style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 2px", borderTop: "1px solid var(--sabbia-bordo)" }}
            >
              <span style={{ font: "500 11px var(--font-outfit)", color: "var(--inchiostro-35)", width: 34, flex: "none" }}>
                {new Date(session.date).toLocaleDateString("it-IT", { weekday: "short" })}
              </span>
              <span style={{ font: "500 13.5px var(--font-outfit)", flex: 1 }}>{session.title}</span>
              {match?.matched && match.distance_km != null ? (
                <span className="font-mono" style={{ fontSize: 11, color: "var(--verde-tratto-scuro)", width: 60, textAlign: "right", flex: "none" }}>
                  svolto {match.distance_km.toFixed(0)}
                </span>
              ) : km > 0 && (
                <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", width: 38, textAlign: "right", flex: "none" }}>
                  {km.toFixed(0)} km
                </span>
              )}
              <div style={{ width: 70, height: 4, flex: "none" }}>
                <BarGrow value={Math.min(1, km / 20)} height={4} color={visual.background} trackColor="var(--sabbia-chip)" active={animate} delayMs={800 + i * 80} />
              </div>
            </SlideUp>
          );
        })}
      </div>
    </div>
  );
}

/** Brand mark and the settings avatar -- rendered identically whether or not the
 * screen's data has arrived, so the top of the page never flickers in. */
function TodayHeader() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <BrandMark height={22} />
      <Link href="/settings" aria-label="Impostazioni" className="tap-target" style={{ display: "block" }}>
        <Avatar size={36} />
      </Link>
    </div>
  );
}

function MetricCard({
  label,
  value,
  unit,
  background,
  color,
  delay,
  active,
  fraction,
  barColor,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  background: string;
  color?: string;
  delay: number;
  active: boolean;
  fraction: number;
  barColor: string;
}) {
  return (
    <SlideUp active={active} delayMs={delay} style={{ flex: 1, background, color, borderRadius: "var(--radius-card)", padding: 15 }}>
      <p style={{ font: "500 11.5px var(--font-outfit)", color: color ? undefined : "var(--inchiostro-50)", opacity: color ? 0.7 : 1, margin: 0 }}>{label}</p>
      <div style={{ marginTop: 8, overflow: "hidden" }}>
        <WordIn active={active} delayMs={delay + 160} style={{ font: "600 25px/1 var(--font-outfit)", letterSpacing: "-.03em" }}>
          {value}
          {unit && <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}> {unit}</span>}
        </WordIn>
      </div>
      <div style={{ marginTop: 11 }}>
        <BarGrow value={fraction} height={4} color={barColor} trackColor="rgba(0,0,0,.08)" active={active} delayMs={delay + 260} />
      </div>
    </SlideUp>
  );
}
