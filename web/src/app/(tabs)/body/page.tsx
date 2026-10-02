"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
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
import { useMountOnce } from "@/lib/motion";
import { useBodyToday, useFuelTargets, usePersonalCorrelations, usePlanQuery, usePrefetchFuelNarrative } from "@/lib/queries";
import { useWatchSyncStatus } from "@/lib/watchSync";
import { toDateKey } from "@/lib/sessionVisuals";
import { formatFullDate, stressCaption } from "@/lib/format";
import { usePassoStore } from "@/lib/store";
import type { DayTarget } from "@/lib/types";

/** Short teaser line for the fuel-preview card ("domani il lungo · stasera
 * carboidrati") -- the full sentence (`advice`/`narrative`) belongs to /body/fuel;
 * this card only has to earn the tap. */
function fuelSubtitle(tomorrow: DayTarget): string {
  const label = tomorrow.session_title?.toLowerCase() ?? "un allenamento";
  if (tomorrow.load === "riposo") return "domani riposo";
  if (tomorrow.load === "duro" || tomorrow.load === "molto_lungo") return `domani ${label} · stasera carboidrati`;
  return `domani ${label}`;
}

export default function RecoveryPage() {
  const router = useRouter();
  const animate = useMountOnce("body-recovery");
  const { data, isLoading } = useBodyToday();
  const { data: correlations } = usePersonalCorrelations(90);
  const { data: plan, isHydrated } = usePlanQuery();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const sessions = plan?.sessions ?? [];
  const today = toDateKey(new Date());
  // Not before the plan is back: asking with an empty plan buys an answer about a day
  // with nothing scheduled, which is neither true nor the one this card shows.
  const fuelQuery = useFuelTargets(today, sessions, manualWeight?.weightKg, isHydrated);
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
    <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark height={22} />
        <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} transition={{ type: "spring", stiffness: 450, damping: 22 }}>
          <Link href="/settings" className="tap-target" aria-label="Impostazioni"><Avatar size={32} /></Link>
        </motion.div>
      </div>

      <header className="screen-intro">
        <h1>Come stai oggi?</h1>
        <p>{data ? formatFullDate(data.date) : "Recupero, energia e allenamento."}</p>
      </header>

      {isLoading ? (
        <div role="status" aria-label="Caricamento dati del corpo" className="body-loading">
          <Skeleton height={144} radius={28} />
          <Skeleton height={180} radius={24} />
          <Skeleton height={150} radius={24} />
        </div>
      ) : !data?.has_overnight_data ? (
        <SlideUp active={animate} delayMs={150} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 16 }}>
          <p className="font-serif-italic" style={{ fontSize: 16, margin: 0 }}>
            L&apos;orologio non ha ancora sincronizzato la notte.
          </p>
        </SlideUp>
      ) : (
        <>
          <SlideUp active={animate} delayMs={150} style={{ marginTop: 16 }}>
            <TiltCard
              maxTilt={4.5}
              style={{
                background: "var(--crema-card)",
                color: "var(--inchiostro)",
                border: "1.5px solid rgba(16, 185, 129, 0.28)",
                boxShadow: "var(--shadow-airbnb-subtle)",
                borderRadius: "var(--radius-card-lg)",
                padding: "20px 18px",
                display: "flex",
                alignItems: "center",
                gap: 16,
              }}
            >
              <ProgressRing value={(data.readiness_score ?? 0) / 100} size={96} strokeWidth={9} trackColor="var(--sabbia-chip)" color="var(--verde-tratto-scuro)">
                <p className="font-mono" style={{ fontSize: 24, fontWeight: 700, margin: 0, color: "var(--inchiostro)" }}>{data.readiness_score ?? "—"}</p>
              </ProgressRing>
              <div style={{ minWidth: 0 }}>
                <p style={{ fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>
                  {(data.readiness_score ?? 0) >= 65 ? "Pronto a lavorare" : "Vacci piano oggi"}
                </p>
                {/* The score used to sit here as a bare ring with a Garmin lookup key
                    under it. The key is decoded server-side now, and when it cannot be,
                    this says what the number is instead of printing an identifier. */}
                {data.readiness_score != null && <ReadinessMeaning score={data.readiness_score} href="/body/prontezza" />}
                <p className="font-serif-italic" style={{ fontSize: 14, margin: "6px 0 0" }}>
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
                      marginTop: 8,
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

          {/* Two cards that used to show one number each with nothing to read it
              against: a sleep total with a single phase under it, and seven unlabelled
              bars. Stacked rather than side by side -- there is no way to fit a phase
              breakdown and a dated axis into half a phone's width. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 14 }}>
            {data.sleep ? (
              <SleepCard sleep={data.sleep} animate={animate} delayMs={280} />
            ) : (
              <SlideUp active={animate} delayMs={280} style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16 }}>
                <p className="font-mono" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: 0 }}>Sonno</p>
                <p style={{ fontSize: 13, margin: "8px 0 0" }}>Non disponibile</p>
              </SlideUp>
            )}
            <HrvCard points={data.hrv_seven_day} lastNight={data.hrv_last_night_ms} animate={animate} delayMs={340} norm={data.hrv_norm} />
          </div>

          <div style={{ display: "flex", gap: 9, marginTop: 9 }}>
            <SmallMetric
              label="Cuore a riposo"
              value={data.resting_heart_rate != null ? `${data.resting_heart_rate}` : "—"}
              unit="bpm"
              caption={
                data.rhr_norm?.has_personal_norm
                  ? `norma ${Math.round(data.rhr_norm.normal_min)}–${Math.round(data.rhr_norm.normal_max)} bpm (media ${Math.round(data.rhr_norm.mean)})`
                  : data.resting_heart_rate_delta != null
                    ? `${data.resting_heart_rate_delta > 0 ? "+" : ""}${data.resting_heart_rate_delta} sulla tua media di 7 giorni`
                    : undefined
              }
              background="var(--crema-card)"
            />
            <SmallMetric
              label="Batteria"
              value={data.battery_percent != null ? `${data.battery_percent}%` : "—"}
              caption="energia rimasta ora, su 100"
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

          <SlideUp active={animate} delayMs={460} style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14 }}>
            {tomorrowSession && (
              <p style={{ fontWeight: 700, fontSize: 14, margin: "0 0 6px" }}>Domani: {tomorrowSession.title.toLowerCase()}</p>
            )}
            <p className="font-serif-italic" style={{ fontSize: 15, margin: 0 }}>
              {(data.readiness_score ?? 100) < 60
                ? "I numeri di oggi meritano attenzione: guarda cosa dice il piano di domani."
                : "I numeri sono con te: il piano di domani può restare com'è."}
            </p>
          </SlideUp>
        </>
      )}

      <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 4 }}>
        <NavRow href="/body/load" label="Carico 4 settimane" />
        <NavRow href="/coach" label="Tecnica e allenamento" />
      </div>

      {fuel && (
        fuelDegraded ? (
          <SlideUp active={animate} delayMs={500} style={{ marginTop: 4 }}>
            <NavRow href="/body/fuel" label="Carburante" />
          </SlideUp>
        ) : (
          <SlideUp active={animate} delayMs={220} style={{ marginTop: 10 }}>
            <TiltCard
              maxTilt={4}
              style={{
                background: "var(--inchiostro)",
                color: "var(--crema)",
                borderRadius: "var(--radius-card-lg)",
                padding: 18,
                position: "relative",
                overflow: "hidden",
              }}
            >
              <Link
                href="/body/fuel"
                className="tap-target"
                onPointerDown={() => prefetchNarrative(today, sessions, manualWeight?.weightKg)}
                style={{ display: "block", color: "inherit", textDecoration: "none", position: "relative", zIndex: 2 }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <p style={{ fontWeight: 700, fontSize: 15, margin: 0 }}>Carburante</p>
                      <ChevronRight size={15} style={{ color: "var(--crema)", opacity: 0.8 }} />
                    </div>
                    <p style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)", margin: "3px 0 0" }}>{fuelSubtitle(fuel.tomorrow)}</p>

                    {fuel.tomorrow.carb_g && (
                      <p className="font-mono" style={{ fontSize: 28, fontWeight: 500, color: "var(--corallo)", margin: "10px 0 0" }}>
                        {fuel.tomorrow.carb_g[0]}–{fuel.tomorrow.carb_g[1]}{" "}
                        <span style={{ fontSize: 14, fontWeight: 400, color: "var(--crema)" }}>g di carboidrati</span>
                      </p>
                    )}
                    <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-su-scuro)", margin: "8px 0 0", lineHeight: 1.35 }}>
                      {fuel.advice}
                    </p>
                  </div>

                  <div style={{ width: 72, height: 72, position: "relative", flexShrink: 0, marginTop: 4 }}>
                    <Illustration name="fuel" width={72} height={72} position="relative" active={animate} delayMs={260} />
                  </div>
                </div>
              </Link>
            </TiltCard>
          </SlideUp>
        )
      )}

      {correlations && (
        <div style={{ marginTop: 14 }}>
          <PersonalCorrelationsCard data={correlations} animate={animate} delayMs={260} />
        </div>
      )}
    </div>
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
      <Link href={href} className="body-nav-row tap-target">
        <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
        <ChevronRight size={16} style={{ color: "var(--inchiostro-50)" }} />
      </Link>
    </motion.div>
  );
}
