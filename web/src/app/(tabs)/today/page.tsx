"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { DayStateCard } from "@/components/DayStateCard";
import { RaceGoalCard } from "@/components/RaceGoalCard";
import { BarGrow, PulseRing, SlideUp, StatusDot, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import {
  useBodyToday,
  useDayVerdict,
  useDayVerdictNarrative,
  usePlanDiff,
  useStravaActivityMatches,
  useStravaStatus,
  useWeekWorkouts,
} from "@/lib/queries";
import { useWatchSyncStatus } from "@/lib/watchSync";
import { SkeletonTodayHero } from "@/components/skeletons";
import { usePassoStore } from "@/lib/store";
import { classifySession, isoWeekNumber, sessionDistanceKm, toDateKey, weekBounds, type DisplaySession } from "@/lib/sessionVisuals";
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
  const verdictQuery = useDayVerdict(verdictSession, access.plan?.goal, wantsVerdict);
  const verdictNarrative = useDayVerdictNarrative(verdictSession, access.plan?.goal, wantsVerdict && !!verdictQuery.data);

  // Until we know whether there's a plan or a live Garmin connection there is nothing
  // real to show -- but "nothing real" used to mean `return null`, i.e. an empty screen
  // for as long as the Garmin status check took. Render the header and the shapes.
  if (!access.ready || (!access.plan && !access.garminConnected)) {
    return (
      <div style={{ padding: "22px 20px 12px" }}>
        <TodayHeader />
        <div style={{ marginTop: 18 }}>
          <WordIn active={animate} style={{ font: "600 34px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>Settimana</WordIn>
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

  const pendingChanges = (diffQuery.data?.to_create.length ?? 0) + (diffQuery.data?.changed.length ?? 0);
  const readiness = bodyQuery.data?.readiness_score;
  const sleepMinutes = bodyQuery.data?.sleep?.total_minutes;

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <TodayHeader />

      <div style={{ marginTop: 18 }}>
        <WordIn active={animate} style={{ font: "600 34px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>Settimana</WordIn>
        <WordIn active={animate} delayMs={100} style={{ font: "600 34px/1.04 var(--font-outfit)", letterSpacing: "-.035em", color: "var(--corallo)" }}>
          {numberToItalianWords(isoWeekNumber(today))}
        </WordIn>
      </div>

      <SlideUp
        active={animate}
        delayMs={200}
        style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 16, height: 210, position: "relative", overflow: "hidden", boxSizing: "border-box" }}
      >
        <span aria-hidden="true" className="anim-sweep-once" style={{ position: "absolute", inset: 0, background: "var(--corallo)" }} />
        <div style={{ position: "relative", color: "var(--corallo-testo)" }}>
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
        <Illustration name="corsa" width={150} height={160} right={0} bottom={0} active={animate} delayMs={900} />
      </SlideUp>

      <DayStateCard verdict={verdictQuery.data} narrative={verdictNarrative.data?.text} animate={animate} delayMs={260} />

      {/* Without a race this asks for one -- but only with a plan behind it, since a
          goal is stored *inside* the plan and there is nowhere to put one in live
          Garmin mode. Counted from today forward: a finished block shouldn't ask. */}
      <RaceGoalCard
        goal={access.plan?.goal}
        upcomingSessions={access.plan ? access.plan.sessions.filter((s) => s.date >= todayKey).length : 0}
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
