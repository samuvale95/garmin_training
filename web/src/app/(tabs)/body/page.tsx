"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { ProgressRing, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useBodyToday } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { toDateKey } from "@/lib/sessionVisuals";
import { formatFullDate, hrvCaption, stressCaption } from "@/lib/format";

export default function RecoveryPage() {
  const animate = useMountOnce("body-recovery");
  const { data, isLoading } = useBodyToday();
  const plan = usePassoStore((s) => s.plan);

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowSession = plan?.sessions.find((s) => s.date === toDateKey(tomorrow)) ?? null;

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark height={22} />
        <Avatar size={32} />
      </div>

      <div style={{ marginTop: 14, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <WordIn active={animate} style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>Come stai</WordIn>
        {data && (
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{formatFullDate(data.date)}</span>
        )}
      </div>

      {isLoading ? (
        <p style={{ marginTop: 20 }}>Carico i dati…</p>
      ) : !data?.has_overnight_data ? (
        <SlideUp active={animate} delayMs={150} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 16 }}>
          <p className="font-serif-italic" style={{ fontSize: 16, margin: 0 }}>
            L&apos;orologio non ha ancora sincronizzato la notte.
          </p>
        </SlideUp>
      ) : (
        <>
          <SlideUp active={animate} delayMs={150} style={{ background: "var(--verde)", color: "var(--verde-testo)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 16, display: "flex", alignItems: "center", gap: 16 }}>
            <ProgressRing value={(data.readiness_score ?? 0) / 100} size={104} strokeWidth={10} trackColor="rgba(31,51,16,.15)" color="var(--verde-testo)">
              <p className="font-mono" style={{ fontSize: 26, fontWeight: 500, margin: 0 }}>{data.readiness_score ?? "—"}</p>
            </ProgressRing>
            <div>
              <p style={{ fontWeight: 700, fontSize: 16, margin: "0 0 4px" }}>
                {(data.readiness_score ?? 0) >= 65 ? "Pronto a lavorare" : "Vacci piano oggi"}
              </p>
              <p className="font-serif-italic" style={{ fontSize: 14, margin: 0 }}>{data.readiness_message ?? "Nessun commento disponibile."}</p>
            </div>
          </SlideUp>

          <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
            <SlideUp active={animate} delayMs={280} style={{ flex: 1, background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: "0 0 8px" }}>Sonno</p>
              {data.sleep ? (
                <>
                  <p className="font-mono" style={{ fontSize: 18, margin: "0 0 8px" }}>
                    {Math.floor((data.sleep.total_minutes ?? 0) / 60)}h{String((data.sleep.total_minutes ?? 0) % 60).padStart(2, "0")}
                  </p>
                  <SleepBar phases={data.sleep} />
                  {data.sleep.deep_minutes != null && (
                    <p style={{ fontSize: 11, margin: "8px 0 0" }}>
                      profondo {Math.floor(data.sleep.deep_minutes / 60)}h{String(data.sleep.deep_minutes % 60).padStart(2, "0")}
                    </p>
                  )}
                </>
              ) : (
                <p style={{ fontSize: 12 }}>Non disponibile</p>
              )}
            </SlideUp>
            <SlideUp active={animate} delayMs={340} style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em", margin: "0 0 8px", color: "var(--inchiostro-50)" }}>Variabilità</p>
              {data.hrv_last_night_ms != null && (
                <p className="font-mono" style={{ fontSize: 18, margin: "0 0 8px" }}>{data.hrv_last_night_ms}<span style={{ fontSize: 12 }}>ms</span></p>
              )}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40 }}>
                {data.hrv_seven_day.map((point, i) => {
                  const isLast = i === data.hrv_seven_day.length - 1;
                  const value = point.value_ms ?? 0;
                  const maxValue = Math.max(...data.hrv_seven_day.map((p) => p.value_ms ?? 0), 1);
                  return (
                    <div
                      key={point.date}
                      className={isLast ? "anim-tip-grow" : undefined}
                      style={{ flex: 1, height: `${Math.max(6, (value / maxValue) * 40)}px`, background: isLast ? "var(--verde-tratto-scuro)" : "var(--neutro-barra)", borderRadius: 2 }}
                    />
                  );
                })}
              </div>
              {hrvCaption(data.hrv_last_night_ms, data.hrv_seven_day) && (
                <p style={{ fontSize: 10, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>{hrvCaption(data.hrv_last_night_ms, data.hrv_seven_day)}</p>
              )}
            </SlideUp>
          </div>

          <div style={{ display: "flex", gap: 9, marginTop: 9 }}>
            <SmallMetric
              label="Cuore a riposo"
              value={data.resting_heart_rate != null ? `${data.resting_heart_rate}` : "—"}
              caption={data.resting_heart_rate_delta != null ? `${data.resting_heart_rate_delta > 0 ? "+" : ""}${data.resting_heart_rate_delta} sulla settimana` : undefined}
              background="var(--crema-card)"
            />
            <SmallMetric label="Batteria" value={data.battery_percent != null ? `${data.battery_percent}%` : "—"} background="var(--giallo)">
              {data.battery_percent != null && (
                <div style={{ height: 3, borderRadius: 100, background: "rgba(31,51,16,.15)", marginTop: 8, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${data.battery_percent}%`, background: "var(--giallo-testo)", borderRadius: 100 }} />
                </div>
              )}
            </SmallMetric>
            <SmallMetric label="Stress" value={data.stress_level != null ? `${data.stress_level}` : "—"} caption={stressCaption(data.stress_level) ?? undefined} background="var(--crema-card)" />
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
      </div>
    </div>
  );
}

function SleepBar({ phases }: { phases: { deep_minutes: number | null; light_minutes: number | null; rem_minutes: number | null; awake_minutes: number | null } }) {
  const total = (phases.deep_minutes ?? 0) + (phases.light_minutes ?? 0) + (phases.rem_minutes ?? 0) + (phases.awake_minutes ?? 0) || 1;
  const segments = [
    { value: phases.deep_minutes ?? 0, color: "var(--azzurro-testo)" },
    { value: phases.rem_minutes ?? 0, color: "var(--lilla)" },
    { value: phases.light_minutes ?? 0, color: "var(--azzurro)" },
    { value: phases.awake_minutes ?? 0, color: "var(--giallo)" },
  ];
  return (
    <div style={{ display: "flex", height: 4, borderRadius: 100, overflow: "hidden" }}>
      {segments.map((s, i) => (
        <div key={i} style={{ width: `${(s.value / total) * 100}%`, background: s.color }} />
      ))}
    </div>
  );
}

function SmallMetric({
  label,
  value,
  caption,
  background,
  children,
}: {
  label: string;
  value: string;
  caption?: string;
  background: string;
  children?: ReactNode;
}) {
  return (
    <div style={{ flex: 1, background, borderRadius: "var(--radius-chip)", padding: 12 }}>
      <p className="font-mono" style={{ fontSize: 16, margin: "0 0 2px" }}>{value}</p>
      <p style={{ fontSize: 10, color: "var(--inchiostro-50)", margin: 0 }}>{label}</p>
      {caption && <p style={{ fontSize: 10, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>{caption}</p>}
      {children}
    </div>
  );
}

function NavRow({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px", textDecoration: "none", color: "inherit" }}>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{label}</span>
      <span className="anim-chev" aria-hidden="true">→</span>
    </Link>
  );
}
