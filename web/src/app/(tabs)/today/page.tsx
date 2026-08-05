"use client";

import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { BarGrow, PulseRing, SlideUp, StatusDot, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { usePlanDiff, useBodyConflict, useBodyToday, useWorkouts } from "@/lib/queries";
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
  const workoutsQuery = useWorkouts(toDateKey(start), toDateKey(end), liveMode);
  const diffQuery = usePlanDiff(access.plan?.sessions ?? null);
  const bodyQuery = useBodyToday();

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);
  const nextPlanSession = access.plan?.sessions.find((s) => s.date === tomorrowKey) ?? null;
  const conflictQuery = useBodyConflict(nextPlanSession);
  const avvisamiSeIlCorpoNonRegge = usePassoStore((s) => s.prefs.avvisamiSeIlCorpoNonRegge);
  const conflictDismissedDate = usePassoStore((s) => s.conflictDismissedDate);

  // "13 Il corpo dice no" replaces Today when this morning's readiness conflicts with
  // tomorrow's session -- dismissed-today check keeps it from re-triggering the moment
  // the conflict screen sends the user back here (see conflictDismissedDate).
  useEffect(() => {
    if (!avvisamiSeIlCorpoNonRegge) return;
    if (!nextPlanSession) return;
    if (!conflictQuery.data?.has_conflict) return;
    if (conflictDismissedDate === todayKey) return;
    router.replace("/body/conflict");
  }, [avvisamiSeIlCorpoNonRegge, nextPlanSession, conflictQuery.data?.has_conflict, conflictDismissedDate, todayKey, router]);

  if (!access.ready || (!access.plan && !access.garminConnected)) return null;

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

  const pendingChanges = (diffQuery.data?.to_create.length ?? 0) + (diffQuery.data?.changed.length ?? 0);
  const readiness = bodyQuery.data?.readiness_score;
  const sleepMinutes = bodyQuery.data?.sleep?.total_minutes;

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark height={22} />
        <Link href="/settings" aria-label="Impostazioni" className="tap-target" style={{ display: "block" }}>
          <Avatar size={36} />
        </Link>
      </div>

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
            </>
          ) : (
            <p className="font-serif-italic" style={{ fontSize: 17, maxWidth: 200 }}>Oggi è un giorno di riposo. E va bene così.</p>
          )}
        </div>
        <Illustration name="corsa" width={150} height={160} right={0} bottom={0} active={animate} delayMs={900} />
      </SlideUp>

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

      {restOfWeek.length > 0 && !liveMode && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 20, padding: "0 2px 6px" }}>
          <span style={{ font: "500 11.5px var(--font-outfit)", color: "var(--inchiostro-50)" }}>resto della settimana</span>
          <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)" }}>{remainingKm.toFixed(1).replace(".0", "")} km</span>
        </div>
      )}
      <div style={{ marginTop: 2, display: "flex", flexDirection: "column", gap: 2 }}>
        {restOfWeek.map((session, i) => {
          const visual = classifySession(session);
          const km = sessionDistanceKm(session);
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
              {km > 0 && (
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
