"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
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
import { ChevronRight, ArrowRight, ArrowUpRight, PlusIcon, TargetIcon, UtensilsIcon } from "@/components/Icons";
import { TodayHeroUnified } from "@/components/TodayHeroUnified";
import { TodayVitalStrip } from "@/components/TodayVitalStrip";
import { PreWorkoutContextCard } from "@/components/PreWorkoutContextCard";
import { QuickMealModal } from "@/components/QuickMealModal";
import { WeekStrip } from "@/components/WeekStrip";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import {
  GOAL_LOOKAHEAD_DAYS,
  useActivities,
  useBodyToday,
  useCheckAdaptation,
  useCheckIns,
  useFuelStatus,
  useFuelTargets,
  useProgress,
  useRefreshServerData,
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
import { classifySession, sessionDistanceKm, shiftDateKey, toDateKey, weekBounds, workoutsToSessions, type DisplaySession } from "@/lib/sessionVisuals";
import { capitalize, formatFullDate, groupSteps, numberToItalianWords, relativeDayLabel, stepGroupLine } from "@/lib/format";

export function TodayView() {
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

  // Quick 1-tap food / snack logging modal
  const [quickMealOpen, setQuickMealOpen] = useState(false);
  const planOrLiveSessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);
  const fuelStatus = useFuelStatus(todayKey, undefined, access.ready);
  const fuelTargets = useFuelTargets(todayKey, planOrLiveSessions, undefined, access.ready);

  // Until we know whether there's a plan or a live Garmin connection there is nothing
  // real to show -- but "nothing real" used to mean `return null`, i.e. an empty screen
  // for as long as the Garmin status check took. Render the header and the shapes.
  if (!access.ready || (!access.plan && !access.garminConnected)) {
    return (
      <div style={{ padding: "22px 20px 12px" }}>
        <TodayHeader onOpenQuickLog={() => setQuickMealOpen(true)} />
        <div style={{ marginTop: 18 }}>
          <WordIn active={animate} style={{ font: "600 34px/1.04 var(--font-sans)", letterSpacing: "-.035em" }}>Il tuo oggi</WordIn>
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
  const refreshMutation = useRefreshServerData();

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div style={{ padding: "22px 20px 12px" }}>
        <TodayHeader onOpenQuickLog={() => setQuickMealOpen(true)} />

        <header className="today-intro">
          <h1>Il tuo oggi</h1>
          <p>{capitalize(formatFullDate(todayKey))} · Un passo alla volta.</p>
        </header>

        {/* 1. HERO ALLENAMENTO + BADGE PRONTEZZA UNIFICATI */}
        <TodayHeroUnified
        heroSession={heroSession}
        heroMainGroup={heroMainGroup}
        heroMatch={heroMatch}
        heroHref={heroHref}
        verdict={verdictQuery.data}
        today={today}
        animate={animate}
      />

      {/* 2. ADATTAMENTO DEL PIANO (Se richiesto) */}
      {hasPlan && <AdaptationCard animate={animate} delayMs={120} />}

      {/* 3. CHECK-IN POST CORSA (On-top prioritario appena conclusa) */}
      {checkInDay && (
        <CheckInCard
          key={checkInDay === "oggi" ? todayKey : yesterdayKey}
          date={checkInDay === "oggi" ? todayKey : yesterdayKey}
          dayLabel={checkInDay}
          trained={trainedOn(checkInDay === "oggi" ? todayKey : yesterdayKey)}
          existing={checkInOn(checkInDay === "oggi" ? todayKey : yesterdayKey)}
          animate={animate}
          delayMs={130}
        />
      )}

      {/* 3b. INSIGHT COACH POST-CORSA: 1-tap all'analisi della tecnica */}
      {trainedOn(todayKey) && (
        <SlideUp active={animate} delayMs={140} style={{ marginTop: 10 }}>
          <Link
            href="/coach"
            className="press-soft"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "var(--crema-card)",
              border: "1px solid var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              borderRadius: "var(--radius-card)",
              padding: "12px 16px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "50%", background: "var(--sabbia-chip)", color: "var(--inchiostro)", flex: "none" }}>
              <TargetIcon size={16} strokeWidth={2} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: "var(--inchiostro)" }}>
                  Analisi Tecnica della corsa
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: ".04em",
                    background: "var(--azzurro)",
                    color: "var(--azzurro-testo)",
                    padding: "2px 6px",
                    borderRadius: "var(--radius-pill)",
                  }}
                >
                  Nuova
                </span>
              </div>
              <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>
                Contatto al suolo, cadenza e split del ritmo analizzati dal coach.
              </p>
            </div>
            <ChevronRight size={16} style={{ color: "var(--inchiostro-50)", flex: "none" }} />
          </Link>
        </SlideUp>
      )}

      {/* 4. CONTEXT BANNER PRE-CORSA: Spuntino & Idratazione rapida (1-tap snack) */}
      {heroSession && (
        <PreWorkoutContextCard
          todayTarget={fuelTargets.data?.today}
          onOpenQuickLog={() => setQuickMealOpen(true)}
          active={animate}
          trained={trainedOn(todayKey) || heroSession.date > todayKey}
          carbLoggedG={fuelStatus.data?.totals?.carb_g ?? 0}
        />
      )}

      {/* 5. VITAL STRIP COMPATTA: Prontezza, Sonno, Carbo (0 tap) */}
      <TodayVitalStrip
        readinessScore={readiness}
        sleepMinutes={sleepMinutes}
        carbLoggedG={fuelStatus.data?.totals?.carb_g ?? 0}
        carbTargetG={fuelTargets.data?.today?.carb_g}
        active={animate}
      />

      {/* 6. STRISCIA 7 GIORNI (LUN-DOM): Panoramica settimana in 0 tap */}
      <WeekStrip
        currentDateKey={todayKey}
        sessions={sessions}
        active={animate}
      />

      {/* 7. MODALE QUICK LOG PASTO / SNACK (1-tap da ovunque) */}
      <QuickMealModal
        isOpen={quickMealOpen}
        onClose={() => setQuickMealOpen(false)}
        todayDateKey={todayKey}
      />

      {/* 8. PROGRESSO E RECORD SETTIMANALI (Compatto) */}
      {progress.data && (
        <Link href="/progress" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={160}>
            <motion.div
              whileHover={{ y: -2, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              style={{
                background: "var(--crema-card)",
                border: "var(--border-airbnb)",
                boxShadow: "var(--shadow-airbnb-subtle)",
                borderRadius: "var(--radius-card)",
                padding: "12px 16px",
                marginTop: 12,
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <Mascot state={progress.data.mascot.state} size={46} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontWeight: 600, fontSize: 14.5, margin: 0 }}>
                  {progress.data.streak} {progress.data.streak === 1 ? "settimana" : "settimane"} di fila
                </p>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <Tokens tokens={progress.data.tokens} max={progress.data.max_tokens} />
                  <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
                    {progress.data.week_points} pt questa settimana
                  </span>
                </div>
              </div>
              <ChevronRight size={16} style={{ color: "var(--inchiostro-50)" }} />
            </motion.div>
          </SlideUp>
        </Link>
      )}

      {earlyInWeek && lastWeek.data && lastWeek.data.done_sessions + lastWeek.data.planned_sessions > 0 && (
        <Link href="/summary" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={170}>
            <motion.div
              whileHover={{ y: -2, scale: 1.01 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              style={{
                background: "var(--sabbia)",
                border: "var(--border-airbnb)",
                boxShadow: "var(--shadow-airbnb-subtle)",
                borderRadius: "var(--radius-card)",
                padding: 13,
                marginTop: 10,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ font: "500 11px var(--font-sans)", color: "var(--inchiostro-50)", margin: 0 }}>La settimana scorsa</p>
                <p style={{ fontSize: 13.5, margin: "2px 0 0" }}>{lastWeek.data.headline}</p>
              </div>
              <ChevronRight size={16} style={{ color: "var(--inchiostro-50)" }} />
            </motion.div>
          </SlideUp>
        </Link>
      )}

      {/* Without a race this asks for one */}
      <RaceGoalCard
        goal={goal}
        upcomingSessions={
          access.plan ? access.plan.sessions.filter((s) => s.date >= todayKey).length : liveLookahead.data?.workouts.length ?? 0
        }
        animate={animate}
        delayMs={180}
      />

      {liveMode ? (
        <Link href="/import" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={200} style={{ background: "var(--crema-card)", border: "1px solid var(--border-airbnb)", boxShadow: "var(--shadow-airbnb-subtle)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
            <p className="font-serif-italic" style={{ fontSize: 15, margin: 0, flex: 1 }}>
              Questo è il calendario Garmin. Importa un piano per i dettagli di ogni seduta.
            </p>
            <ChevronRight size={16} style={{ color: "var(--inchiostro-50)" }} />
          </SlideUp>
        </Link>
      ) : pendingChanges > 0 ? (
        <Link href="/diff" style={{ textDecoration: "none", color: "inherit" }}>
          <SlideUp active={animate} delayMs={200} style={{ background: "var(--crema-card)", border: "1px solid var(--border-airbnb)", boxShadow: "var(--shadow-airbnb-subtle)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
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
              <ArrowRight size={16} strokeWidth={2.4} />
            </span>
          </SlideUp>
        </Link>
      ) : (
        <SlideUp active={animate} delayMs={200} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 4px", marginTop: 10 }}>
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
          <span style={{ font: "500 11.5px var(--font-sans)", color: "var(--inchiostro-50)" }}>resto della settimana</span>
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
              delayMs={220 + i * 30}
              row
            >
              <motion.div
                whileHover={{ x: 5 }}
                transition={{ type: "spring", stiffness: 450, damping: 26 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "7px 4px",
                  borderRadius: "var(--radius-sm)",
                  borderTop: "1px solid var(--sabbia-bordo)",
                }}
              >
                <span style={{ font: "500 11px var(--font-sans)", color: "var(--inchiostro-35)", width: 34, flex: "none" }}>
                  {new Date(session.date).toLocaleDateString("it-IT", { weekday: "short" })}
                </span>
                <span style={{ font: "500 13.5px var(--font-sans)", flex: 1 }}>{session.title}</span>
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
                  <BarGrow value={Math.min(1, km / 20)} height={4} color={visual.background} trackColor="var(--sabbia-chip)" active={animate} delayMs={250 + i * 30} />
                </div>
              </motion.div>
            </SlideUp>
          );
        })}
      </div>
    </div>
  </PullToRefresh>
  );
}

/** Brand mark, 1-tap quick food button, and the settings avatar */
function TodayHeader({ onOpenQuickLog }: { onOpenQuickLog?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <BrandMark height={22} />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {onOpenQuickLog && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.94 }}
            onClick={onOpenQuickLog}
            className="tap-target"
            aria-label="Registra cibo o snack"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              background: "var(--crema-card)",
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              borderRadius: "var(--radius-pill)",
              padding: "6px 12px",
              cursor: "pointer",
              color: "var(--inchiostro)",
              fontSize: 12.5,
              fontWeight: 600,
            }}
          >
            <UtensilsIcon size={14} strokeWidth={2} />
            <span>+ Cibo</span>
          </motion.button>
        )}
        <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} transition={{ type: "spring", stiffness: 450, damping: 22 }}>
          <Link href="/settings" aria-label="Impostazioni" className="tap-target" style={{ display: "block" }}>
            <Avatar size={36} withStatusBadge={true} />
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
