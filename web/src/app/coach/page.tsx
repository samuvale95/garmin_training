"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp } from "@/components/motion/primitives";
import { FocusBlock, MetricRow, PacingBlock, TrendSection } from "@/components/TechniqueBlocks";
import { useMountOnce } from "@/lib/motion";
import { useActivities, useActivityForm, useCoachNarrative, useSportTrend } from "@/lib/queries";
import { shiftDateKey, toDateKey } from "@/lib/sessionVisuals";
import { formatPaceOrDash, formatShortDate } from "@/lib/format";
import type { CompletedActivity } from "@/lib/types";

/** Screen "Tecnica": how the last sessions were actually *done*, not how much of them
 * there was.
 *
 * The rest of the app measures volume, readiness and fuelling. This is the only screen
 * that opens the metrics the watch has been recording all along -- ground contact time,
 * vertical ratio, pedalling cadence, SWOLF -- and says what each one is, what band it
 * falls in, and the one drill worth trying next.
 *
 * One session at a time, with one thing to work on -- a dashboard of every metric across
 * every session is a dashboard nobody acts on. The trend section is the exception, and
 * it earns it: "il contatto è 268 ms" is a readout, "il contatto è sceso di 17 ms in un
 * mese" is the only half of that a coach would actually say.
 */

// Four weeks back. Far enough to always have something to read even for someone who
// trains twice a week, short enough that the Garmin range stays cheap.
const LOOKBACK_DAYS = 28;

// The sports `technique.py` has reference bands for. A strength session has nothing to
// read here, and offering it would promise an analysis that arrives empty.
const READABLE_SPORTS = new Set(["running", "cycling", "swimming"]);

const SPORT_LABELS: Record<string, string> = {
  running: "corsa",
  cycling: "bici",
  swimming: "nuoto",
};

export default function CoachPage() {
  const animate = useMountOnce("coach");
  const today = toDateKey(new Date());
  const activitiesQuery = useActivities(shiftDateKey(today, -LOOKBACK_DAYS), today);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const readable = useMemo(
    () =>
      (activitiesQuery.data?.activities ?? [])
        .filter((a) => READABLE_SPORTS.has(a.sport))
        .sort((a, b) => b.date.localeCompare(a.date)),
    [activitiesQuery.data]
  );

  // Nothing picked yet means the most recent one: the session a coach would ask about.
  const activityId = selectedId ?? readable[0]?.activity_id ?? null;
  const formQuery = useActivityForm(activityId);
  const narrativeQuery = useCoachNarrative(activityId, !!formQuery.data?.has_metrics);
  const form = formQuery.data;

  // The trend follows the *selected session's own sport*, not whatever sport the last
  // activity happened to be: comparing a run's cadence against a ride's would be
  // comparing two different measurements that share a word.
  const sameSport = useMemo(
    () => (form ? readable.filter((a) => a.sport === form.sport).map((a) => a.activity_id) : []),
    [readable, form]
  );
  const trendQuery = useSportTrend(sameSport, !!form?.has_metrics);

  return (
    <div style={{ padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <PageHeader backHref="/body" />
        <h1 style={{ font: "600 20px/1 var(--font-outfit)", letterSpacing: "-.02em", margin: 0, flex: 1 }}>Tecnica</h1>
      </div>

      {activitiesQuery.isPending ? (
        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={150} radius={27} />
          <Skeleton height={120} radius={22} />
        </div>
      ) : readable.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* The block-level read sits above the per-session one on purpose: a single
              session's form metrics are interesting, but the distribution across eight
              weeks is the thing that actually changes how someone trains. */}
          {/* The diagnosis-and-prescription screen leads: it is the only one here that
              goes from a measurement to a session in the plan, and it needs no imported
              plan to work. */}
          <SlideUp active={animate} delayMs={30} style={{ marginTop: 18 }}>
            <Link
              href="/coach/allenarsi"
              className="press-soft"
              style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card)", padding: "16px 18px", textDecoration: "none" }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ font: "600 15.5px/1.2 var(--font-outfit)", margin: 0 }}>Come ti alleni</p>
                <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-su-scuro)", margin: "6px 0 0", lineHeight: 1.35 }}>
                  Un anno di corse contro il riferimento della ricerca, e le sedute che
                  cambierebbero il quadro.
                </p>
              </div>
              <span aria-hidden="true" className="anim-chev" style={{ flex: "none", fontSize: 18 }}>→</span>
            </Link>
          </SlideUp>

          <SlideUp active={animate} delayMs={40} style={{ marginTop: 10 }}>
            <Link
              href="/coach/esecuzione"
              className="press-soft"
              style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: "15px 18px", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ flex: 1 }}>
                <p style={{ font: "600 15.5px/1.2 var(--font-outfit)", margin: 0 }}>Come ti alleni davvero</p>
                <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "6px 0 0", lineHeight: 1.35 }}>
                  Otto settimane di sedute lette secondo per secondo, contro quello che il piano
                  chiedeva e contro il riferimento della ricerca.
                </p>
              </div>
              <span aria-hidden="true" className="anim-chev" style={{ flex: "none", fontSize: 18 }}>→</span>
            </Link>
          </SlideUp>

          <ActivityPicker activities={readable} selectedId={activityId} onSelect={setSelectedId} animate={animate} />

          {formQuery.isPending || !form ? (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <Skeleton height={150} radius={27} />
              <Skeleton height={200} radius={22} />
            </div>
          ) : (
            <>
              <FocusBlock form={form} animate={animate} narrativeText={narrativeQuery.data?.text} />

              <SlideUp active={animate} delayMs={160} style={{ display: "flex", gap: 9, marginTop: 12 }}>
                <Stat label="distanza" value={form.distance_km != null ? `${form.distance_km} km` : "—"} />
                <Stat label="ritmo medio" value={formatPaceOrDash(form.average_pace_sec_per_km)} />
                <Stat label="cuore" value={form.average_heart_rate != null ? `${form.average_heart_rate} bpm` : "—"} />
              </SlideUp>

              {!form.has_metrics && (
                <SlideUp active={animate} delayMs={200} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
                  <p style={{ fontWeight: 600, fontSize: 15, margin: 0 }}>Per questa seduta non c&apos;è niente da leggere</p>
                  <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.35 }}>
                    I dati di tecnica servono un orologio che li registri -- per la corsa una fascia
                    o un sensore compatibile, per la bici un misuratore di potenza. Senza, resta il
                    ritmo, e nemmeno quello se la seduta è un giro unico senza parziali.
                  </p>
                </SlideUp>
              )}

              {form.pacing && <PacingBlock pacing={form.pacing} animate={animate} delayMs={220} />}

              {trendQuery.data && (
                <TrendSection
                  trends={trendQuery.data.trends}
                  sessionsRead={trendQuery.data.sessions_read}
                  animate={animate}
                />
              )}

              {form.metrics.length > 0 && (
                <div style={{ marginTop: 22 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
                    Le misure, una per una
                  </span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
                    {form.metrics.map((metric, i) => (
                      <MetricRow key={metric.key} metric={metric} animate={animate} delayMs={260 + i * 50} />
                    ))}
                  </div>
                </div>
              )}

              <p style={{ fontSize: 12, color: "var(--inchiostro-35)", margin: "18px 0 0", lineHeight: 1.45 }}>
                Ogni riferimento qui sopra è una fascia di popolazione, non un obiettivo: i numeri
                cambiano con il ritmo, con il terreno e con le scarpe, e rincorrerli è un ottimo
                modo per farsi male. Orientamento sportivo generale, non un consiglio clinico né
                fisioterapico.
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** The last few readable sessions, newest first. Horizontal because the list is short
 * and the analysis under it is the screen -- a full-height picker would bury it. */
function ActivityPicker({
  activities,
  selectedId,
  onSelect,
  animate,
}: {
  activities: CompletedActivity[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  animate: boolean;
}) {
  return (
    <SlideUp active={animate} delayMs={60} style={{ marginTop: 18 }}>
      <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
        {activities.slice(0, 12).map((activity) => {
          const active = activity.activity_id === selectedId;
          return (
            <button
              key={activity.activity_id}
              type="button"
              onClick={() => onSelect(activity.activity_id)}
              className="press-soft"
              style={{
                flex: "none",
                background: active ? "var(--inchiostro)" : "var(--crema-card)",
                color: active ? "var(--crema)" : "inherit",
                border: "none",
                borderRadius: "var(--radius-chip)",
                padding: "11px 14px",
                textAlign: "left",
                cursor: "pointer",
                minWidth: 118,
              }}
            >
              <span className="font-mono" style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".05em", opacity: 0.7, display: "block" }}>
                {formatShortDate(activity.date)} · {SPORT_LABELS[activity.sport] ?? activity.sport}
              </span>
              <span style={{ fontSize: 13.5, fontWeight: 600, display: "block", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 150 }}>
                {activity.title || "Attività"}
              </span>
              {activity.distance_km != null && (
                <span className="font-mono" style={{ fontSize: 11, opacity: 0.7, display: "block", marginTop: 2 }}>
                  {activity.distance_km} km
                </span>
              )}
            </button>
          );
        })}
      </div>
    </SlideUp>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-chip)", padding: 12 }}>
      <p className="font-mono" style={{ fontSize: 15, margin: 0 }}>{value}</p>
      <p style={{ fontSize: 10, color: "var(--inchiostro-50)", margin: "3px 0 0" }}>{label}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card-lg)", padding: 20 }}>
        <p style={{ fontWeight: 600, fontSize: 15.5, margin: 0 }}>Nessuna seduta da analizzare</p>
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: "8px 0 0", lineHeight: 1.35 }}>
          Qui finiscono le corse, le uscite in bici e le nuotate delle ultime quattro settimane,
          lette per come le hai fatte. Al momento non ne vedo nessuna.
        </p>
      </div>
      <Link
        href="/settings"
        className="press-soft"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: "15px 18px", marginTop: 10, textDecoration: "none", color: "inherit" }}
      >
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>Controlla la connessione a Garmin</span>
        <span aria-hidden="true" className="anim-chev">→</span>
      </Link>
    </div>
  );
}
