"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Avatar } from "@/components/Avatar";
import { HrvCard, ReadinessMeaning, SleepCard } from "@/components/BodyCards";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { ProgressRing, SlideUp } from "@/components/motion/primitives";
import { TiltCard } from "@/components/motion/TiltCard";
import { ChevronRight, AlertTriangleIcon } from "@/components/Icons";
import { PersonalCorrelationsCard } from "@/components/PersonalCorrelationsCard";
import { AerobicEfficiencyCard } from "@/components/AerobicEfficiencyCard";
import { LoadingIndicator3D } from "@/components/LoadingIndicator3D";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useAerobicEfficiency, useBodyToday, useFuelTargets, usePersonalCorrelations, usePlanQuery, usePrefetchFuelNarrative, useRefreshServerData, useWeekWorkouts } from "@/lib/queries";
import { useWatchSyncStatus } from "@/lib/watchSync";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { formatFullDate, stressCaption } from "@/lib/format";
import { usePassoStore } from "@/lib/store";
import { useTrainingSlot } from "@/lib/trainingHabits";
import { FOCUS_LINE, useDayFocus, type DayFocus } from "@/lib/dayFocus";
import type { BodySnapshot, DayTarget } from "@/lib/types";
import { useScreenReady } from "@/lib/useScreenReady";

/** Short teaser line for the fuel-preview card ("domani il lungo · stasera
 * carboidrati") -- the full sentence (`advice`/`narrative`) belongs to /body/fuel;
 * this card only has to earn the tap. */
function fuelSubtitle(tomorrow: DayTarget): string {
  const label = tomorrow.session_title?.toLowerCase() ?? "un allenamento";
  if (tomorrow.load === "riposo") return "domani riposo";
  if (tomorrow.load === "duro" || tomorrow.load === "molto_lungo") return `domani ${label} · stasera carboidrati`;
  return `domani ${label}`;
}

export function BodyView() {
  const router = useRouter();
  const [activeSubTab, setActiveSubTab] = useState<"oggi" | "trend">("oggi");
  const access = useCalendarAccess();
  const refreshMutation = useRefreshServerData();
  const animate = useMountOnce("body-recovery");
  const { data, isLoading } = useBodyToday();
  useScreenReady(!isLoading, "/body");
  const { data: correlations } = usePersonalCorrelations(90);
  const { data: aerobicEfficiency } = useAerobicEfficiency(90);
  const { data: plan } = usePlanQuery();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const today = new Date();
  const todayKey = toDateKey(today);
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWeekWorkouts(today, liveMode);

  const sessions = access.plan
    ? access.plan.sessions
    : workoutsToSessions(workoutsQuery.data?.workouts ?? []);

  // Targets query starts as soon as access is ready
  const training = useTrainingSlot(todayKey, access.ready);
  const fuelQuery = useFuelTargets(todayKey, sessions, manualWeight?.weightKg, access.ready && training.ready, training.slot);
  const prefetchNarrative = usePrefetchFuelNarrative();
  const fuel = fuelQuery.data;
  const fuelDegraded = fuel?.weight_source === "reference" && sessions.length === 0;

  // Same substitution as Oggi: with a watch that hasn't synced in over 24h this screen
  // is nothing but em dashes, so screen 19 takes its place (see useWatchSyncStatus).
  const watchSync = useWatchSyncStatus();
  useEffect(() => {
    if (watchSync.blocking) router.replace("/watch-sync");
  }, [watchSync.blocking, router]);

  const tomorrowKey = shiftDateKey(todayKey, 1);
  const tomorrowSession = (plan?.sessions ?? sessions).find((s) => s.date === tomorrowKey) ?? null;

  // What this screen leads with: the night before a session, the tank after it, tomorrow
  // in the evening (see dayFocus).
  const { focus } = useDayFocus({
    todayKey,
    sessionToday: sessions.some((s) => s.date === todayKey),
    training,
    garminConnected: access.garminConnected,
    enabled: access.ready,
  });

  // Tomorrow's fuel: the dark card when tomorrow is a hard day (tonight's carbohydrates
  // are the point), a plain one otherwise -- the same block either way, louder only when
  // there is something to act on.
  const fuelMatters = !!fuel && (fuel.tomorrow.load === "duro" || fuel.tomorrow.load === "molto_lungo");
  const nutritionSection = (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, padding: "0 4px" }}>
        <p
          className="font-mono"
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: ".06em",
            textTransform: "uppercase",
            color: "var(--inchiostro-50)",
            margin: 0,
          }}
        >
          Nutrizione & Carburante
        </p>
        <Link data-track="body.nutrition"
          href="/nutrition"
          style={{ fontSize: 12, fontWeight: 600, color: "var(--rosso-avviso)", textDecoration: "none" }}
        >
          Vai alla scheda Nutrizione →
        </Link>
      </div>

      {fuelQuery.isLoading ? (
        <div
          className="anim-clay-shimmer"
          style={{
            background: "var(--crema-card)",
            borderRadius: "var(--radius-card-lg)",
            border: "var(--border-airbnb)",
            boxShadow: "var(--shadow-airbnb-subtle)",
            padding: 16,
            minHeight: 80,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          <div style={{ width: 120, height: 14, background: "var(--sabbia-chip)", borderRadius: 6 }} />
          <div style={{ width: "60%", height: 18, background: "var(--sabbia)", borderRadius: 6 }} />
        </div>
      ) : fuelDegraded ? (
        <SlideUp active={animate} delayMs={380}>
          <NavRow href="/nutrition" label="Strategia Nutrizionale Completa" />
        </SlideUp>
      ) : fuel ? (
        <SlideUp active={animate} delayMs={220}>
          <TiltCard
            maxTilt={3.5}
            style={{
              background: fuelMatters ? "var(--inchiostro)" : "var(--crema-card)",
              color: fuelMatters ? "var(--crema)" : "var(--inchiostro)",
              border: fuelMatters ? "none" : "var(--border-airbnb)",
              boxShadow: fuelMatters ? "var(--shadow-airbnb-card)" : "var(--shadow-airbnb-subtle)",
              borderRadius: "var(--radius-card-lg)",
              padding: "16px 18px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            <Link data-track="body.nutrition-2"
              href="/nutrition"
              className="tap-target"
              onPointerDown={() => prefetchNarrative(todayKey, sessions, manualWeight?.weightKg)}
              style={{ display: "block", color: "inherit", textDecoration: "none", position: "relative", zIndex: 2 }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, background: fuelMatters ? "rgba(255,255,255,0.12)" : "var(--sabbia-chip)", padding: "2px 8px", borderRadius: "var(--radius-pill)", fontWeight: 600 }}>
                      {fuelSubtitle(fuel.tomorrow)}
                    </span>
                  </div>

                  {fuel.tomorrow.carb_g && (
                    <p className="font-mono" style={{ fontSize: 24, fontWeight: 600, color: fuelMatters ? "var(--corallo)" : "var(--corallo-accent)", margin: "8px 0 2px" }}>
                      {fuel.tomorrow.carb_g[0]}–{fuel.tomorrow.carb_g[1]}{" "}
                      <span style={{ fontSize: 13, fontWeight: 400, color: "inherit" }}>g carboidrati</span>
                    </p>
                  )}
                  <p className="font-serif-italic" style={{ fontSize: 13, color: fuelMatters ? "var(--inchiostro-su-scuro)" : "var(--inchiostro-70)", margin: 0, lineHeight: 1.35 }}>
                    {fuel.advice}
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <Illustration name="fuel" width={52} height={52} position="relative" active={animate} delayMs={260} />
                  <ChevronRight size={16} style={{ color: "inherit", opacity: 0.6 }} />
                </div>
              </div>
            </Link>
          </TiltCard>
        </SlideUp>
      ) : null}
    </div>
  );

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark height={22} />
        <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} transition={{ type: "spring", stiffness: 450, damping: 22 }}>
          <Link data-track="body.impostazioni" href="/settings" className="tap-target" aria-label="Impostazioni"><Avatar size={32} /></Link>
        </motion.div>
      </div>

      <header className="screen-intro">
        <h1>Come stai oggi?</h1>
        <p>{data ? formatFullDate(data.date) : "Recupero, energia e allenamento."}</p>
        {data?.has_overnight_data && activeSubTab === "oggi" && (
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--inchiostro-70)", margin: "4px 0 0" }}>{FOCUS_LINE[focus]}</p>
        )}
      </header>

      {/* SELETTORE A PILLOLE: OGGI VS TREND (Stile Airbnb) */}
      <div style={{ marginTop: 18, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            background: "var(--sabbia)",
            padding: 4,
            borderRadius: "var(--radius-pill)",
            position: "relative",
            border: "var(--border-airbnb)",
          }}
        >
          <button data-track="body.setactivesubtab"
            type="button"
            onClick={() => setActiveSubTab("oggi")}
            style={{
              flex: 1,
              position: "relative",
              border: "none",
              background: "transparent",
              padding: "9px 12px",
              borderRadius: "var(--radius-pill)",
              fontSize: 13.5,
              fontWeight: activeSubTab === "oggi" ? 700 : 500,
              color: activeSubTab === "oggi" ? "var(--inchiostro)" : "var(--inchiostro-50)",
              cursor: "pointer",
              transition: "color 0.2s ease",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span>Recupero Oggi</span>
            {activeSubTab === "oggi" && (
              <motion.div
                layoutId="body-subtab-indicator"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--crema)",
                  borderRadius: "var(--radius-pill)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  zIndex: -1,
                }}
              />
            )}
          </button>

          <button data-track="body.setactivesubtab-2"
            type="button"
            onClick={() => setActiveSubTab("trend")}
            style={{
              flex: 1,
              position: "relative",
              border: "none",
              background: "transparent",
              padding: "9px 12px",
              borderRadius: "var(--radius-pill)",
              fontSize: 13.5,
              fontWeight: activeSubTab === "trend" ? 700 : 500,
              color: activeSubTab === "trend" ? "var(--inchiostro)" : "var(--inchiostro-50)",
              cursor: "pointer",
              transition: "color 0.2s ease",
              zIndex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
            }}
          >
            <span>Trend & Fisiologia</span>
            {activeSubTab === "trend" && (
              <motion.div
                layoutId="body-subtab-indicator"
                transition={{ type: "spring", stiffness: 450, damping: 32 }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--crema)",
                  borderRadius: "var(--radius-pill)",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  zIndex: -1,
                }}
              />
            )}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div style={{ marginTop: 24, marginBottom: 24 }}>
          <div
            style={{
              background: "var(--crema-card)",
              borderRadius: 24,
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              padding: "24px 16px",
            }}
          >
            <LoadingIndicator3D
              label="Analizzo lo stato del corpo..."
              sublabel="Lettura HRV, prontezza e parametri vitali"
              size={84}
              minHeight={200}
            />
          </div>
        </div>
      ) : activeSubTab === "oggi" ? (
        /* VISTA 1: RECUPERO & STATO DI OGGI, nell'ordine che conta adesso */
        <BodyTodaySections data={data} focus={focus} tomorrowTitle={tomorrowSession?.title ?? null} animate={animate} nutrition={nutritionSection} />
      ) : (
        /* VISTA 2: TREND, APPROFONDIMENTI & FISIOLOGIA A MEDIO/LUNGO TERMINE */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          style={{ display: "flex", flexDirection: "column", gap: 16 }}
        >
          {/* NAVIGAZIONE APPROFONDIMENTI RAPIDI */}
          <div>
            <p
              className="font-mono"
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".06em",
                textTransform: "uppercase",
                color: "var(--inchiostro-50)",
                margin: "0 0 8px 4px",
              }}
            >
              Panoramiche
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <NavRow href="/body/load" label="Carico cronico & 4 settimane" />
              <NavRow href="/coach" label="Tecnica, dinamica e passo" />
            </div>
          </div>

          {/* EFFICIENZA AEROBICA & DECOUPLING */}
          {aerobicEfficiency && (
            <div>
              <p
                className="font-mono"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--inchiostro-50)",
                  margin: "0 0 8px 4px",
                }}
              >
                Efficienza Aerobica
              </p>
              <AerobicEfficiencyCard data={aerobicEfficiency} animate={animate} />
            </div>
          )}

          {/* CORRELAZIONI BIOMETRICHE A 90 GIORNI */}
          {correlations && (
            <div>
              <p
                className="font-mono"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: ".06em",
                  textTransform: "uppercase",
                  color: "var(--inchiostro-50)",
                  margin: "0 0 8px 4px",
                }}
              >
                Correlazioni a 90 Giorni
              </p>
              <PersonalCorrelationsCard data={correlations} animate={animate} delayMs={150} />
            </div>
          )}
        </motion.div>
      )}
    </div>
    </PullToRefresh>
  );
}

/** How loud the readiness score should be: the colour of the ring and of the card's
 * edge say "go", "careful" or "stop" before the number is read. */
function readinessTone(score: number | null): { color: string; edge: string } {
  if (score == null || score >= 65) return { color: "var(--verde-tratto-scuro)", edge: "rgba(16, 185, 129, 0.28)" };
  if (score >= 50) return { color: "var(--rosso-avviso)", edge: "rgba(179, 74, 32, 0.32)" };
  return { color: "var(--corallo-accent)", edge: "rgba(217, 45, 85, 0.38)" };
}

// Below this the battery is worth pointing at: what's left for the rest of the day is
// thin, which is what matters after a session.
const LOW_BATTERY_PERCENT = 30;
const HIGH_STRESS = 50;
const RHR_DELTA_ALERT = 5;

/** The "Oggi" half of Corpo. The same five blocks every time -- readiness, vitals, the
 * night, tomorrow, food -- in the order the moment asks for (see `DayFocus`): in the
 * morning the night comes first, after a session the tank, in the evening tomorrow. A
 * number outside its range is marked where it stands rather than left for the user to
 * judge against a norm they don't remember. */
function BodyTodaySections({
  data,
  focus,
  tomorrowTitle,
  animate,
  nutrition,
}: {
  data: BodySnapshot | undefined;
  focus: DayFocus;
  tomorrowTitle: string | null;
  animate: boolean;
  nutrition: ReactNode;
}) {
  if (!data?.has_overnight_data) {
    return (
      <>
        <SlideUp active={animate} delayMs={150} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 12 }}>
          <p className="font-serif-italic" style={{ fontSize: 16, margin: 0 }}>
            L&apos;orologio non ha ancora sincronizzato la notte.
          </p>
        </SlideUp>
        {nutrition}
      </>
    );
  }

  const score = data.readiness_score;
  const tone = readinessTone(score);
  const careful = (score ?? 100) < 60;

  const rhrHigh =
    data.resting_heart_rate != null &&
    (data.rhr_norm?.has_personal_norm
      ? data.resting_heart_rate > data.rhr_norm.normal_max
      : (data.resting_heart_rate_delta ?? 0) >= RHR_DELTA_ALERT);
  const batteryLow = data.battery_percent != null && data.battery_percent < LOW_BATTERY_PERCENT;
  const stressHigh = data.stress_level != null && data.stress_level >= HIGH_STRESS;

  const readiness = (
    <SlideUp active={animate} delayMs={150} style={{ marginTop: 12 }}>
      <TiltCard
        maxTilt={4.5}
        style={{
          background: "var(--crema-card)",
          color: "var(--inchiostro)",
          border: `1.5px solid ${tone.edge}`,
          boxShadow: "var(--shadow-airbnb-subtle)",
          borderRadius: "var(--radius-card-lg)",
          padding: "18px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}
      >
        <ProgressRing value={(score ?? 0) / 100} size={90} strokeWidth={8.5} trackColor="var(--sabbia-chip)" color={tone.color}>
          <p className="font-mono" style={{ fontSize: 23, fontWeight: 700, margin: 0, color: "var(--inchiostro)" }}>{score ?? "—"}</p>
        </ProgressRing>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 700, fontSize: 15.5, margin: "0 0 3px" }}>
            {focus === "prontezza" ? ((score ?? 0) >= 65 ? "Pronto a lavorare" : "Vacci piano oggi") : "Prontezza di stamattina"}
          </p>
          {score != null && <ReadinessMeaning score={score} href="/body/prontezza" />}
          <p className="font-serif-italic" style={{ fontSize: 13.5, margin: "5px 0 0", lineHeight: 1.3 }}>
            {data.readiness_message ?? "Tocca il punteggio per vedere da cosa nasce."}
          </p>
          {data.overnight_reliability === "parziale" && (
            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "rgba(255, 255, 255, 0.45)",
                color: "var(--verde-testo)",
                padding: "3px 8px",
                borderRadius: 6,
                fontSize: 11,
                fontWeight: 600,
                marginTop: 6,
              }}
            >
              <AlertTriangleIcon size={12} strokeWidth={2.2} />
              <span>Dato notturno parziale</span>
              {data.overnight_reliability_note && <span style={{ fontWeight: 400, opacity: 0.85 }}>· {data.overnight_reliability_note}</span>}
            </div>
          )}
        </div>
      </TiltCard>
    </SlideUp>
  );

  const vitals = (
    <div style={{ marginTop: 16 }}>
      <SectionLabel>{focus === "prontezza" ? "Parametri vitali" : "Come stai adesso"}</SectionLabel>
      <div style={{ display: "flex", gap: 9 }}>
        <SmallMetric
          label="Cuore a riposo"
          value={data.resting_heart_rate != null ? `${data.resting_heart_rate}` : "—"}
          unit="bpm"
          caption={
            data.rhr_norm?.has_personal_norm
              ? `norma ${Math.round(data.rhr_norm.normal_min)}–${Math.round(data.rhr_norm.normal_max)}`
              : data.resting_heart_rate_delta != null
                ? `${data.resting_heart_rate_delta > 0 ? "+" : ""}${data.resting_heart_rate_delta} vs 7gg`
                : undefined
          }
          alert={rhrHigh ? "più alto del solito" : undefined}
        />
        <SmallMetric
          label="Body Battery"
          value={data.battery_percent != null ? `${data.battery_percent}%` : "—"}
          caption="energia residua"
          alert={batteryLow ? "riserva bassa" : undefined}
        >
          {data.battery_percent != null && (
            <div style={{ height: 4, borderRadius: 100, background: "var(--sabbia-chip)", marginTop: 8, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${data.battery_percent}%`, background: batteryLow ? "var(--corallo-accent)" : "var(--giallo-testo)", borderRadius: 100 }} />
            </div>
          )}
        </SmallMetric>
        <SmallMetric
          label="Stress"
          value={data.stress_level != null ? `${data.stress_level}` : "—"}
          unit="su 100"
          caption={stressHigh ? undefined : stressCaption(data.stress_level) ?? undefined}
          alert={stressHigh ? "sopra la norma" : undefined}
        />
      </div>
    </div>
  );

  const night = (
    <div style={{ marginTop: 18 }}>
      <SectionLabel>{focus === "prontezza" ? "Riposo & Sonno" : "La notte scorsa"}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.sleep ? (
          <SleepCard sleep={data.sleep} animate={animate} delayMs={240} />
        ) : (
          <SlideUp active={animate} delayMs={240} style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16 }}>
            <p className="font-mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: 0 }}>Sonno</p>
            <p style={{ fontSize: 13, margin: "8px 0 0" }}>Non disponibile</p>
          </SlideUp>
        )}
        <HrvCard points={data.hrv_seven_day} lastNight={data.hrv_last_night_ms} animate={animate} delayMs={300} norm={data.hrv_norm} />
      </div>
    </div>
  );

  // Dark only when it carries a warning: "the plan can stay as it is" is reassurance,
  // not news, and should not outshout the numbers above it.
  const tomorrow = (
    <SlideUp
      active={animate}
      delayMs={focus === "prontezza" ? 360 : 150}
      style={{
        background: careful ? "var(--inchiostro)" : "var(--crema-card)",
        color: careful ? "var(--crema)" : "var(--inchiostro)",
        border: careful ? "none" : "var(--border-airbnb)",
        boxShadow: careful ? "var(--shadow-airbnb-card)" : "var(--shadow-airbnb-subtle)",
        borderRadius: "var(--radius-card)",
        padding: "16px 18px",
        marginTop: 18,
      }}
    >
      <p style={{ fontWeight: 700, fontSize: 13.5, margin: "0 0 4px" }}>
        {tomorrowTitle ? `Domani: ${tomorrowTitle.toLowerCase()}` : "Domani: riposo"}
      </p>
      <p className="font-serif-italic" style={{ fontSize: 14.5, margin: 0, color: careful ? "var(--inchiostro-su-scuro)" : "var(--inchiostro-70)" }}>
        {!tomorrowTitle
          ? careful
            ? "Un giorno di riposo arriva al momento giusto: lascia che il corpo recuperi."
            : "Nessun allenamento in programma: recupera e goditi la giornata."
          : careful
            ? "I numeri di oggi consigliano prudenza: guarda cosa suggerisce il piano di domani."
            : "I numeri sono positivi: il piano di domani può restare com'è."}
      </p>
    </SlideUp>
  );

  const blocks = { readiness, vitals, night, tomorrow, nutrition };
  const order: Record<DayFocus, (keyof typeof blocks)[]> = {
    prontezza: ["readiness", "night", "vitals", "tomorrow", "nutrition"],
    recupero: ["vitals", "tomorrow", "nutrition", "readiness", "night"],
    domani: ["tomorrow", "nutrition", "vitals", "readiness", "night"],
  };
  return <>{order[focus].map((name) => <Fragment key={name}>{blocks[name]}</Fragment>)}</>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      className="font-mono"
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".06em",
        textTransform: "uppercase",
        color: "var(--inchiostro-50)",
        margin: "0 0 8px 4px",
      }}
    >
      {children}
    </p>
  );
}

function SmallMetric({
  label,
  value,
  unit,
  caption,
  alert,
  children,
}: {
  label: string;
  value: string;
  /** The unit, where the number has one that isn't obvious from the figure itself.
   * "53" and "53 bpm" are not the same amount of information. */
  unit?: string;
  caption?: string;
  /** Set when the value is outside its range: a short phrase saying how, printed in the
   * accent colour with an accent edge, so the one number to look at is found first. */
  alert?: string;
  children?: ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -2.5, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      style={{
        flex: 1,
        minWidth: 0,
        background: alert ? "var(--corallo-chiaro)" : "var(--crema-card)",
        borderRadius: "var(--radius-row)",
        padding: 12,
        border: alert ? "1.5px solid rgba(217, 45, 85, 0.35)" : "var(--border-airbnb)",
        boxShadow: "var(--shadow-airbnb-subtle)",
      }}
    >
      <p className="font-mono" style={{ fontSize: 16, margin: "0 0 2px" }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}> {unit}</span>}
      </p>
      <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>{label}</p>
      {caption && <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>{caption}</p>}
      {alert && <p style={{ fontSize: 12, fontWeight: 700, color: "var(--corallo-testo)", margin: "4px 0 0" }}>{alert}</p>}
      {children}
    </motion.div>
  );
}

function NavRow({ href, label }: { href: string; label: string }) {
  return (
    <motion.div whileHover={{ x: 4, scale: 1.01 }} whileTap={{ scale: 0.98 }} transition={{ type: "spring", stiffness: 450, damping: 26 }}>
      <Link data-track="body.href" href={href} className="body-nav-row tap-target">
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        <ChevronRight size={16} style={{ color: "var(--inchiostro-50)" }} />
      </Link>
    </motion.div>
  );
}
