"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Avatar } from "@/components/Avatar";
import { HrvCard, ReadinessMeaning, SleepCard } from "@/components/BodyCards";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { ProgressRing, SlideUp, Skeleton } from "@/components/motion/primitives";
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
import { toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { formatFullDate, stressCaption } from "@/lib/format";
import { usePassoStore } from "@/lib/store";
import type { DayTarget } from "@/lib/types";
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
  const fuelQuery = useFuelTargets(todayKey, sessions, manualWeight?.weightKg, access.ready);
  const prefetchNarrative = usePrefetchFuelNarrative();
  const fuel = fuelQuery.data;
  const fuelDegraded = fuel?.weight_source === "reference" && sessions.length === 0;

  // Same substitution as Oggi: with a watch that hasn't synced in over 24h this screen
  // is nothing but em dashes, so screen 19 takes its place (see useWatchSyncStatus).
  const watchSync = useWatchSyncStatus();
  useEffect(() => {
    if (watchSync.blocking) router.replace("/watch-sync");
  }, [watchSync.blocking, router]);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowSession = plan?.sessions.find((s) => s.date === toDateKey(tomorrow)) ?? null;

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
        /* VISTA 1: RECUPERO & STATO DI OGGI */
        <>
          {!data?.has_overnight_data ? (
            <SlideUp active={animate} delayMs={150} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 12 }}>
              <p className="font-serif-italic" style={{ fontSize: 16, margin: 0 }}>
                L&apos;orologio non ha ancora sincronizzato la notte.
              </p>
            </SlideUp>
          ) : (
            <>
              {/* HERO PRONTEZZA */}
              <SlideUp active={animate} delayMs={150} style={{ marginTop: 12 }}>
                <TiltCard
                  maxTilt={4.5}
                  style={{
                    background: "var(--crema-card)",
                    color: "var(--inchiostro)",
                    border: "1.5px solid rgba(16, 185, 129, 0.28)",
                    boxShadow: "var(--shadow-airbnb-subtle)",
                    borderRadius: "var(--radius-card-lg)",
                    padding: "18px 16px",
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                  }}
                >
                  <ProgressRing value={(data.readiness_score ?? 0) / 100} size={90} strokeWidth={8.5} trackColor="var(--sabbia-chip)" color="var(--verde-tratto-scuro)">
                    <p className="font-mono" style={{ fontSize: 23, fontWeight: 700, margin: 0, color: "var(--inchiostro)" }}>{data.readiness_score ?? "—"}</p>
                  </ProgressRing>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 15.5, margin: "0 0 3px" }}>
                      {(data.readiness_score ?? 0) >= 65 ? "Pronto a lavorare" : "Vacci piano oggi"}
                    </p>
                    {data.readiness_score != null && <ReadinessMeaning score={data.readiness_score} href="/body/prontezza" />}
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
                        {data.overnight_reliability_note && (
                          <span style={{ fontWeight: 400, opacity: 0.85 }}>· {data.overnight_reliability_note}</span>
                        )}
                      </div>
                    )}
                  </div>
                </TiltCard>
              </SlideUp>

              {/* GRIGLIA PARAMETRI VITALI */}
              <div style={{ marginTop: 16 }}>
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
                  Parametri Vitali
                </p>
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
                    background="var(--crema-card)"
                  />
                  <SmallMetric
                    label="Body Battery"
                    value={data.battery_percent != null ? `${data.battery_percent}%` : "—"}
                    caption="energia residua"
                    background="var(--crema-card)"
                  >
                    {data.battery_percent != null && (
                      <div style={{ height: 4, borderRadius: 100, background: "var(--sabbia-chip)", marginTop: 8, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${data.battery_percent}%`, background: "var(--giallo-testo)", borderRadius: 100 }} />
                      </div>
                    )}
                  </SmallMetric>
                  <SmallMetric
                    label="Stress"
                    value={data.stress_level != null ? `${data.stress_level}` : "—"}
                    unit="su 100"
                    caption={stressCaption(data.stress_level) ?? undefined}
                    background="var(--crema-card)"
                  />
                </div>
              </div>

              {/* SEZIONE: RIPOSO & SONNO */}
              <div style={{ marginTop: 18 }}>
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
                  Riposo & Sonno
                </p>
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

              {/* IMPATTO SUL PIANO */}
              <SlideUp active={animate} delayMs={360} style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card)", padding: "16px 18px", marginTop: 18 }}>
                {tomorrowSession && (
                  <p style={{ fontWeight: 700, fontSize: 13.5, margin: "0 0 4px", color: "var(--crema)" }}>Domani: {tomorrowSession.title.toLowerCase()}</p>
                )}
                <p className="font-serif-italic" style={{ fontSize: 14.5, margin: 0, opacity: 0.9 }}>
                  {(data.readiness_score ?? 100) < 60
                    ? "I numeri di oggi consigliano prudenza: guarda cosa suggerisce il piano di domani."
                    : "I numeri sono positivi: il piano di domani può restare com'è."}
                </p>
              </SlideUp>
            </>
          )}

          {/* SEZIONE: NUTRIZIONE & STRATEGIA (Compatta con link alla pagina dedicata) */}
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
                    background: "var(--inchiostro)",
                    color: "var(--crema)",
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
                          <span style={{ fontSize: 13, background: "rgba(255,255,255,0.12)", padding: "2px 8px", borderRadius: "var(--radius-pill)", fontWeight: 600 }}>
                            {fuelSubtitle(fuel.tomorrow)}
                          </span>
                        </div>

                        {fuel.tomorrow.carb_g && (
                          <p className="font-mono" style={{ fontSize: 24, fontWeight: 600, color: "var(--corallo)", margin: "8px 0 2px" }}>
                            {fuel.tomorrow.carb_g[0]}–{fuel.tomorrow.carb_g[1]}{" "}
                            <span style={{ fontSize: 13, fontWeight: 400, color: "var(--crema)" }}>g carboidrati</span>
                          </p>
                        )}
                        <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-su-scuro)", margin: 0, lineHeight: 1.35 }}>
                          {fuel.advice}
                        </p>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                        <Illustration name="fuel" width={52} height={52} position="relative" active={animate} delayMs={260} />
                        <ChevronRight size={16} style={{ color: "var(--crema)", opacity: 0.6 }} />
                      </div>
                    </div>
                  </Link>
                </TiltCard>
              </SlideUp>
            ) : null}
          </div>
        </>
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

function SmallMetric({
  label,
  value,
  unit,
  caption,
  background,
  children,
}: {
  label: string;
  value: string;
  /** The unit, where the number has one that isn't obvious from the figure itself.
   * "53" and "53 bpm" are not the same amount of information. */
  unit?: string;
  caption?: string;
  background: string;
  children?: ReactNode;
}) {
  return (
    <motion.div
      whileHover={{ y: -2.5, scale: 1.02 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      style={{
        flex: 1,
        minWidth: 0,
        background,
        borderRadius: "var(--radius-row)",
        padding: 12,
        border: "var(--border-airbnb)",
        boxShadow: "var(--shadow-airbnb-subtle)",
      }}
    >
      <p className="font-mono" style={{ fontSize: 16, margin: "0 0 2px" }}>
        {value}
        {unit && <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}> {unit}</span>}
      </p>
      <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>{label}</p>
      {caption && <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>{caption}</p>}
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
