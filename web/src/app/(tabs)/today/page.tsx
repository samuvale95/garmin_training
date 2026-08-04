"use client";

import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { BarGrow, PulseRing, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { usePlanDiff, useBodyToday, useWorkouts } from "@/lib/queries";
import { classifySession, isoWeekNumber, sessionDistanceKm, toDateKey, weekBounds, type DisplaySession } from "@/lib/sessionVisuals";
import { capitalize, formatFullDate, groupSteps, numberToItalianWords, relativeDayLabel, stepGroupLine } from "@/lib/format";

export default function TodayPage() {
  const access = useCalendarAccess();
  const animate = useMountOnce("today");
  const today = new Date();
  const { start, end } = weekBounds(today);
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWorkouts(toDateKey(start), toDateKey(end), liveMode);
  const diffQuery = usePlanDiff(access.plan?.sessions ?? null);
  const bodyQuery = useBodyToday();

  if (!access.ready || (!access.plan && !access.garminConnected)) return null;

  const sessions: DisplaySession[] = access.plan ? access.plan.sessions : workoutsQuery.data?.workouts ?? [];

  const todayKey = toDateKey(today);
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
        <Avatar size={36} />
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
        <div style={{ position: "relative" }}>
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
        <MetricCard label="Volume" value={liveMode ? "—" : `${weekKm.toFixed(0)} km`} background="var(--crema-card)" delay={340} active={animate} fraction={liveMode ? 0 : Math.min(1, weekKm / 60)} barColor="var(--corallo)" />
        <MetricCard label="Prontezza" value={readiness != null ? String(readiness) : "—"} background="var(--verde)" delay={420} active={animate} fraction={readiness != null ? readiness / 100 : 0} barColor="var(--verde-tratto-scuro)" />
        <MetricCard
          label="Sonno"
          value={sleepMinutes != null ? `${Math.floor(sleepMinutes / 60)}h${String(sleepMinutes % 60).padStart(2, "0")}` : "—"}
          background="var(--azzurro)"
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
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--verde-tratto)" }} />
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>in pari col calendario</span>
        </SlideUp>
      )}

      {restOfWeek.length > 0 && !liveMode && (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 20 }}>
          <span style={{ fontSize: 11, color: "var(--inchiostro-50)", textTransform: "uppercase", letterSpacing: ".06em" }}>resto della settimana</span>
          <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{remainingKm.toFixed(1).replace(".0", "")} km</span>
        </div>
      )}
      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
        {restOfWeek.map((session, i) => {
          const visual = classifySession(session);
          const km = sessionDistanceKm(session);
          return (
            <SlideUp key={`${session.date}-${i}`} active={animate} delayMs={720 + i * 80} row style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px" }}>
              <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", width: 34 }}>
                {new Date(session.date).toLocaleDateString("it-IT", { weekday: "short" })}
              </span>
              <span style={{ fontSize: 13, flex: 1 }}>{session.title}</span>
              {km > 0 && (
                <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{km.toFixed(0)} km</span>
              )}
              <div style={{ width: 48, height: 4 }}>
                <BarGrow value={Math.min(1, km / 20)} height={4} color={visual.background} trackColor="var(--sabbia-chip)" active={animate} delayMs={800 + i * 80} />
              </div>
            </SlideUp>
          );
        })}
      </div>
    </div>
  );
}

function MetricCard({ label, value, background, delay, active, fraction, barColor }: { label: string; value: string; background: string; delay: number; active: boolean; fraction: number; barColor: string }) {
  return (
    <SlideUp active={active} delayMs={delay} style={{ flex: 1, background, borderRadius: "var(--radius-card)", padding: 14 }}>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: ".06em" }}>{label}</p>
      <WordIn active={active} delayMs={delay + 160} style={{ font: "600 22px/1 var(--font-outfit)", letterSpacing: "-.02em" }}>{value}</WordIn>
      <div style={{ marginTop: 10 }}>
        <BarGrow value={fraction} height={4} color={barColor} trackColor="rgba(0,0,0,.08)" active={active} delayMs={delay + 260} />
      </div>
    </SlideUp>
  );
}
