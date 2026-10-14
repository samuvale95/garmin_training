"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Avatar } from "@/components/Avatar";
import { HrvCard, readinessBand, SleepCard } from "@/components/BodyCards";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { ProgressRing, SlideUp } from "@/components/motion/primitives";
import { TiltCard } from "@/components/motion/TiltCard";
import { AlertTriangleIcon, BatteryIcon, CheckIcon, ChevronRight, HeartIcon, LightningIcon, MoonIcon, PulseIcon, RunnerIcon, SunIcon, TrendUpIcon } from "@/components/Icons";
import { PersonalCorrelationsCard } from "@/components/PersonalCorrelationsCard";
import { AerobicEfficiencyCard } from "@/components/AerobicEfficiencyCard";
import { LoadingIndicator3D } from "@/components/LoadingIndicator3D";
import { PullToRefresh } from "@/components/PullToRefresh";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useAerobicEfficiency, useBodyToday, useFuelTargets, usePersonalCorrelations, usePlanQuery, usePrefetchFuelNarrative, useRefreshServerData, useWeekWorkouts } from "@/lib/queries";
import { useWatchSyncStatus } from "@/lib/watchSync";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { formatFullDate } from "@/lib/format";
import { usePassoStore } from "@/lib/store";
import { useTrainingSlot } from "@/lib/trainingHabits";
import { FOCUS_LINE, useDayFocus, type DayFocus } from "@/lib/dayFocus";
import { bodySignals, readinessStatus, STATUS_STYLE, type BodySignal, type SignalKey, type SignalStatus } from "@/lib/bodySignals";
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
          <FocusChip focus={focus} />
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
              <NavRow href="/body/load" label="Carico & forma" hint="Quanto stai caricando nelle ultime 4 settimane" icon={<TrendUpIcon size={16} />} tint="var(--azzurro)" ink="var(--azzurro-testo)" />
              <NavRow href="/coach" label="Tecnica e passo" hint="Cadenza, dinamica e ritmi delle tue corse" icon={<RunnerIcon size={16} />} tint="var(--verde)" ink="var(--verde-tratto-scuro)" />
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

const SIGNAL_ICON: Record<SignalKey, (props: { size?: number }) => ReactNode> = {
  sonno: MoonIcon,
  hrv: PulseIcon,
  cuore: HeartIcon,
  battery: BatteryIcon,
  stress: LightningIcon,
};

/** The verdict in words. Before a session it is advice; after it, or in the evening,
 * the morning's score is history and is told as such. */
function readinessHeadline(status: SignalStatus, focus: DayFocus): string {
  if (focus === "prontezza") {
    if (status === "ok") return "Pronto a lavorare";
    if (status === "attenzione") return "Allenati, senza forzare";
    return "Vacci piano oggi";
  }
  if (status === "ok") return "Stamattina eri pronto";
  if (status === "attenzione") return "Stamattina eri a metà";
  return "Stamattina eri scarico";
}

// After a session or in the evening the vitals sit above the readiness card already;
// it lists only what they don't show.
const VITAL_KEYS: SignalKey[] = ["cuore", "battery", "stress"];

/** The "Oggi" half of Corpo. The same five blocks every time -- readiness, vitals, the
 * night, tomorrow, food -- in the order the moment asks for (see `DayFocus`): in the
 * morning the night comes first, after a session the tank, in the evening tomorrow.
 *
 * Every number arrives judged (see `bodySignals`): the readiness card names the ones
 * that are off before anything else is read, and each tile and card wears its verdict's
 * colour, so the screen can be skimmed by colour and read only where it is not green. */
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
  const status = readinessStatus(score);
  const tone = STATUS_STYLE[status];
  const careful = (score ?? 100) < 60;
  const signals = bodySignals(data);
  const byKey = (key: SignalKey) => signals.find((s) => s.key === key) ?? null;
  const summarized = focus === "prontezza" ? signals : signals.filter((s) => !VITAL_KEYS.includes(s.key));
  const offSignals = summarized.filter((s) => s.status !== "ok");
  const okSignals = summarized.filter((s) => s.status === "ok");

  const readiness = (
    <SlideUp active={animate} delayMs={150} style={{ marginTop: 12 }}>
      <TiltCard
        maxTilt={4.5}
        style={{
          background: `linear-gradient(160deg, ${tone.bg} 0%, var(--crema-card) 72%)`,
          color: "var(--inchiostro)",
          border: `1.5px solid ${tone.edge}`,
          boxShadow: "var(--shadow-airbnb-subtle)",
          borderRadius: "var(--radius-card-lg)",
          padding: "18px 16px 16px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ProgressRing value={(score ?? 0) / 100} size={92} strokeWidth={9} trackColor="rgba(255,255,255,0.7)" color={tone.stroke}>
            <div style={{ textAlign: "center", lineHeight: 1 }}>
              <p className="font-mono" style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "var(--inchiostro)" }}>{score ?? "—"}</p>
              <p className="font-mono" style={{ fontSize: 10, margin: "3px 0 0", color: "var(--inchiostro-50)" }}>su 100</p>
            </div>
          </ProgressRing>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p className="font-mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: tone.text, margin: 0 }}>
              {focus === "prontezza" ? "Prontezza" : "Prontezza di stamattina"}
              {score != null && ` · ${readinessBand(score).label}`}
            </p>
            <p style={{ fontWeight: 700, fontSize: 21, lineHeight: 1.15, letterSpacing: "-.01em", margin: "4px 0 0" }}>
              {readinessHeadline(status, focus)}
            </p>
            {data.readiness_message && (
              <p style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "4px 0 0", lineHeight: 1.3 }}>{data.readiness_message}</p>
            )}
            <Link data-track="body.prontezza" href="/body/prontezza" style={{ display: "inline-block", fontSize: 12, fontWeight: 600, color: tone.text, marginTop: 6, textDecoration: "none" }}>
              Da cosa nasce →
            </Link>
          </div>
        </div>

        {summarized.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(0,0,0,0.07)", marginTop: 14, paddingTop: 12 }}>
            {offSignals.length > 0 && (
              <>
                <p style={{ fontSize: 12, fontWeight: 700, margin: "0 0 8px", color: "var(--inchiostro-70)" }}>Da tenere d&apos;occhio</p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                  {offSignals.map((s) => (
                    <SignalChip key={s.key} signal={s} />
                  ))}
                </div>
              </>
            )}
            {okSignals.length > 0 && (
              <p style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, margin: offSignals.length > 0 ? "10px 0 0" : 0, color: STATUS_STYLE.ok.text }}>
                <CheckIcon size={14} strokeWidth={2.6} style={{ color: STATUS_STYLE.ok.stroke, flex: "none" }} />
                <span>
                  <strong>Nella norma:</strong> {okSignals.map((s) => s.label).join(" · ")}
                </span>
              </p>
            )}
          </div>
        )}

        {data.overnight_reliability === "parziale" && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: STATUS_STYLE.attenzione.bg,
              color: STATUS_STYLE.attenzione.text,
              padding: "3px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 600,
              marginTop: 10,
            }}
          >
            <AlertTriangleIcon size={12} strokeWidth={2.2} />
            <span>Dato notturno parziale</span>
            {data.overnight_reliability_note && <span style={{ fontWeight: 400, opacity: 0.85 }}>· {data.overnight_reliability_note}</span>}
          </div>
        )}
      </TiltCard>
    </SlideUp>
  );

  const heart = byKey("cuore");
  const battery = byKey("battery");
  const stress = byKey("stress");
  const rhrNorm = data.rhr_norm?.has_personal_norm ? data.rhr_norm : null;
  const vitals = (
    <div style={{ marginTop: 18 }}>
      <SectionLabel>{focus === "prontezza" ? "Parametri vitali" : "Come stai adesso"}</SectionLabel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        <MetricTile signal={heart} fallbackLabel="Cuore a riposo" icon={HeartIcon}>
          {rhrNorm && data.resting_heart_rate != null && (
            <RangeGauge value={data.resting_heart_rate} low={rhrNorm.normal_min} high={rhrNorm.normal_max} color={STATUS_STYLE[heart?.status ?? "ok"].stroke} />
          )}
        </MetricTile>
        <MetricTile signal={battery} fallbackLabel="Body Battery" icon={BatteryIcon}>
          {data.battery_percent != null && <FillGauge percent={data.battery_percent} color={STATUS_STYLE[battery?.status ?? "ok"].stroke} />}
        </MetricTile>
        <MetricTile signal={stress} fallbackLabel="Stress" icon={LightningIcon}>
          {data.stress_level != null && <FillGauge percent={data.stress_level} color={STATUS_STYLE[stress?.status ?? "ok"].stroke} />}
        </MetricTile>
      </div>
    </div>
  );

  const night = (
    <div style={{ marginTop: 18 }}>
      <SectionLabel>{focus === "prontezza" ? "La notte" : "La notte scorsa"}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.sleep ? (
          <SleepCard sleep={data.sleep} animate={animate} delayMs={240} signal={byKey("sonno")} />
        ) : (
          <SlideUp active={animate} delayMs={240} style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16 }}>
            <p className="font-mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: 0 }}>Sonno</p>
            <p style={{ fontSize: 13, margin: "8px 0 0" }}>Non disponibile</p>
          </SlideUp>
        )}
        <HrvCard points={data.hrv_seven_day} lastNight={data.hrv_last_night_ms} animate={animate} delayMs={300} norm={data.hrv_norm} signal={byKey("hrv")} />
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
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 32,
          height: 32,
          flex: "none",
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          background: careful ? "rgba(255,255,255,0.12)" : STATUS_STYLE.ok.bg,
          color: careful ? "var(--corallo)" : STATUS_STYLE.ok.stroke,
        }}
      >
        {careful ? <AlertTriangleIcon size={16} strokeWidth={2.2} /> : <CheckIcon size={16} strokeWidth={2.6} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 3px" }}>
          {tomorrowTitle ? `Domani: ${tomorrowTitle.toLowerCase()}` : "Domani: riposo"}
        </p>
        <p style={{ fontSize: 13.5, lineHeight: 1.35, margin: 0, color: careful ? "var(--inchiostro-su-scuro)" : "var(--inchiostro-70)" }}>
          {!tomorrowTitle
            ? careful
              ? "Il riposo arriva al momento giusto."
              : "Recupera e goditi la giornata."
            : careful
              ? "I numeri di oggi consigliano prudenza: valuta di alleggerire."
              : "I numeri sono buoni: il piano può restare com'è."}
        </p>
      </div>
    </SlideUp>
  );

  const blocks = { readiness, vitals, night, tomorrow, nutrition };
  const order: Record<DayFocus, (keyof typeof blocks)[]> = {
    prontezza: ["readiness", "vitals", "night", "tomorrow", "nutrition"],
    recupero: ["vitals", "tomorrow", "nutrition", "readiness", "night"],
    domani: ["tomorrow", "nutrition", "vitals", "readiness", "night"],
  };
  return <>{order[focus].map((name) => <Fragment key={name}>{blocks[name]}</Fragment>)}</>;
}

/** One out-of-range number inside the readiness card: what it is, how much, and what is
 * wrong with it, on the verdict's colour. Two to a row, so four of them stay compact. */
function SignalChip({ signal }: { signal: BodySignal }) {
  const style = STATUS_STYLE[signal.status];
  const Icon = SIGNAL_ICON[signal.key];
  return (
    <div style={{ minWidth: 0, background: style.bg, color: style.text, borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600 }}>
        <span aria-hidden="true" style={{ color: style.stroke, display: "inline-flex" }}><Icon size={13} /></span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{signal.label}</span>
      </span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
        <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--inchiostro)" }}>
          {signal.value}
          {signal.unit && <span style={{ fontSize: 10.5, fontWeight: 400 }}> {signal.unit}</span>}
        </span>
        <span style={{ fontSize: 11.5, fontWeight: 700 }}>{signal.verdict}</span>
      </span>
    </div>
  );
}

const FOCUS_ICON: Record<DayFocus, ReactNode> = {
  prontezza: <SunIcon size={13} />,
  recupero: <RunnerIcon size={13} />,
  domani: <MoonIcon size={13} />,
};

/** Which moment of the day the screen is ordered for, as a chip rather than a sentence. */
function FocusChip({ focus }: { focus: DayFocus }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        marginTop: 8,
        padding: "4px 10px",
        borderRadius: "var(--radius-pill)",
        background: focus === "domani" ? "var(--lilla)" : focus === "recupero" ? "var(--verde)" : "var(--giallo)",
        color: focus === "domani" ? "var(--lilla-testo)" : focus === "recupero" ? "var(--verde-testo)" : "var(--giallo-testo)",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {FOCUS_ICON[focus]}
      {FOCUS_LINE[focus]}
    </span>
  );
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

/** A vital as a tile coloured by its verdict: plain card when fine, amber or coral
 * when not, with the verdict as its last line and a small gauge to show how far off. */
function MetricTile({
  signal,
  fallbackLabel,
  icon: Icon,
  children,
}: {
  signal: BodySignal | null;
  fallbackLabel: string;
  icon: (props: { size?: number }) => ReactNode;
  children?: ReactNode;
}) {
  const status = signal?.status ?? "ok";
  const style = STATUS_STYLE[status];
  const flagged = status !== "ok";
  return (
    <motion.div
      whileHover={{ y: -2.5, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      style={{
        minWidth: 0,
        background: flagged ? style.bg : "var(--crema-card)",
        borderRadius: "var(--radius-row)",
        padding: "11px 11px 12px",
        border: flagged ? `1.5px solid ${style.edge}` : "var(--border-airbnb)",
        boxShadow: "var(--shadow-airbnb-subtle)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <span style={{ display: "flex", alignItems: "flex-start", gap: 5, color: flagged ? style.text : "var(--inchiostro-70)" }}>
        <span aria-hidden="true" style={{ color: style.stroke, display: "inline-flex", marginTop: 1 }}><Icon size={13} /></span>
        <span style={{ fontSize: 11.5, fontWeight: 600, lineHeight: 1.2 }}>{signal?.label ?? fallbackLabel}</span>
      </span>
      <p className="font-mono" style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 0", letterSpacing: "-.02em" }}>
        {signal?.value ?? "—"}
        {signal?.unit && <span style={{ fontSize: 11, fontWeight: 400, color: "var(--inchiostro-50)" }}> {signal.unit}</span>}
      </p>
      {children}
      {signal && (
        <p style={{ fontSize: 11.5, fontWeight: 700, color: flagged ? style.text : STATUS_STYLE.ok.stroke, margin: "6px 0 0", lineHeight: 1.2 }}>{signal.verdict}</p>
      )}
    </motion.div>
  );
}

/** How full something is, 0-100. */
function FillGauge({ percent, color }: { percent: number; color: string }) {
  return (
    <div aria-hidden="true" style={{ height: 5, borderRadius: 100, background: "rgba(0,0,0,0.07)", marginTop: 8, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, percent))}%`, background: color, borderRadius: 100 }} />
    </div>
  );
}

/** Where a value sits against its personal normal band: the band in green, the value as
 * a dot, so "56, norm 46-52" is seen as "to the right of the band" without reading. */
function RangeGauge({ value, low, high, color }: { value: number; low: number; high: number; color: string }) {
  const pad = Math.max(4, (high - low) * 0.8);
  const min = Math.min(low - pad, value - 2);
  const max = Math.max(high + pad, value + 2);
  const at = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <div aria-hidden="true" title={`norma ${Math.round(low)}–${Math.round(high)}`} style={{ position: "relative", height: 5, borderRadius: 100, background: "rgba(0,0,0,0.07)", marginTop: 8 }}>
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${at(low)}%`, width: `${at(high) - at(low)}%`, background: STATUS_STYLE.ok.edge, borderRadius: 100 }} />
      <div style={{ position: "absolute", top: -3, left: `calc(${at(value)}% - 5.5px)`, width: 11, height: 11, borderRadius: "50%", background: color, border: "2px solid var(--crema-card)" }} />
    </div>
  );
}

function NavRow({
  href,
  label,
  hint,
  icon,
  tint,
  ink,
}: {
  href: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  tint?: string;
  ink?: string;
}) {
  return (
    <motion.div whileHover={{ x: 4, scale: 1.01 }} whileTap={{ scale: 0.98 }} transition={{ type: "spring", stiffness: 450, damping: 26 }}>
      <Link data-track="body.href" href={href} className="body-nav-row tap-target">
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          {icon && (
            <span aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", background: tint, color: ink }}>
              {icon}
            </span>
          )}
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14.5, fontWeight: 600 }}>{label}</span>
            {hint && <span style={{ display: "block", fontSize: 12, color: "var(--inchiostro-50)", marginTop: 2 }}>{hint}</span>}
          </span>
        </span>
        <ChevronRight size={16} style={{ color: "var(--inchiostro-50)", flex: "none" }} />
      </Link>
    </motion.div>
  );
}
