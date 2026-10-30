"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { HrvCard, readinessBand, SleepCard } from "@/components/BodyCards";
import { ProgressRing, SlideUp } from "@/components/motion/primitives";
import { AlertTriangleIcon, BatteryIcon, CheckIcon, HeartIcon, LightningIcon, MoonIcon, PulseIcon } from "@/components/Icons";
import { PersonalCorrelationsCard } from "@/components/PersonalCorrelationsCard";
import { AerobicEfficiencyCard } from "@/components/AerobicEfficiencyCard";
import { LoadingIndicator3D } from "@/components/LoadingIndicator3D";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Badge, EmptyState, Notice, RowLink, Section } from "@/components/ui";
import { useMountOnce } from "@/lib/motion";
import { useCalendarAccess } from "@/lib/guards";
import { useAerobicEfficiency, useBodyToday, useFuelTargets, usePersonalCorrelations, usePlanQuery, usePrefetchFuelNarrative, useRefreshServerData, useWeekWorkouts } from "@/lib/queries";
import { lastSyncLabel, missingDataNote, useWatchSyncStatus } from "@/lib/watchSync";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { formatFullDate } from "@/lib/format";
import { usePassoStore } from "@/lib/store";
import { useTrainingSlot } from "@/lib/trainingHabits";
import { useDayFocus, type DayFocus } from "@/lib/dayFocus";
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

  const watchSync = useWatchSyncStatus();

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
  // Nutrition has one home; here only a pointer to tomorrow's fuel, when it matters.
  const fuelMatters = !!fuel && (fuel.tomorrow.load === "duro" || fuel.tomorrow.load === "molto_lungo");
  const nutritionSection = fuel && !fuelDegraded ? (
    <Section title="Alimentazione" id="body-fuel">
      <ul className="list">
        <li>
          <RowLink
            href={`/nutrition?date=${todayKey}`}
            track="body.nutrition"
            title={capitalizeFirst(fuelSubtitle(fuel.tomorrow))}
            meta={fuel.tomorrow.carb_g ? `${fuel.tomorrow.carb_g[0]}–${fuel.tomorrow.carb_g[1]} g di carboidrati indicati per domani` : "Indicazioni nella sezione Nutrizione"}
            end={fuelMatters ? <Badge tone="accent">Da preparare</Badge> : undefined}
          />
        </li>
      </ul>
    </Section>
  ) : null;
  void prefetchNarrative;

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div className="page">
        <header className="page-head">
          <div>
            <h1 className="page-title">Recupero</h1>
            <p className="page-sub">
              {data ? `Dati Garmin di ${formatFullDate(data.date)}` : "Sonno, prontezza, energia e carico."}
            </p>
          </div>
        </header>

        <nav className="subnav" aria-label="Sezioni del recupero">
          <button type="button" aria-pressed={activeSubTab === "oggi"} onClick={() => setActiveSubTab("oggi")} data-track="body.setactivesubtab">Oggi</button>
          <button type="button" aria-pressed={activeSubTab === "trend"} onClick={() => setActiveSubTab("trend")} data-track="body.setactivesubtab-2">Tendenze</button>
        </nav>

        {watchSync.ready && watchSync.blocking && (
          <div style={{ marginBottom: 16 }}>
            <Notice
              tone="warn"
              title="Dati da aggiornare"
              action={<Link href="/watch-sync?from=%2Fbody" className="btn" data-size="sm" data-track="recovery.connection-help">Controlla connessione</Link>}
            >
              {missingDataNote(watchSync.missing)} Ultima acquisizione: {lastSyncLabel(watchSync.lastSyncedAt)}. I dati disponibili restano consultabili.
            </Notice>
          </div>
        )}

        {isLoading ? (
          <div className="card">
            <LoadingIndicator3D label="Leggo i dati della notte…" sublabel="HRV, prontezza e parametri vitali" size={72} minHeight={180} />
          </div>
        ) : activeSubTab === "oggi" ? (
          <div className="split">
            <div className="stack-lg">
              <BodyTodaySections data={data} focus={focus} tomorrowTitle={tomorrowSession?.title ?? null} animate={animate} nutrition={null} />
            </div>
            <aside className="stack-lg" aria-label="Approfondimenti">
              <Section title="Approfondimenti" id="body-more">
                <ul className="list">
                  <li><RowLink href="/body/prontezza?from=%2Fbody" track="body.prontezza-row" title="Da cosa nasce la prontezza" meta="I fattori che la compongono, uno per uno" /></li>
                  <li><RowLink href="/body/load" track="body.load" title="Carico e forma" meta="Ultime 4 settimane: carico acuto, cronico e bilancio" /></li>
                  <li><RowLink href="/body/stato?from=%2Fbody" track="body.stato" title="Stato di oggi rispetto al piano" meta="Cosa dicono i dati sulla seduta di oggi" /></li>
                </ul>
              </Section>
              {nutritionSection}
            </aside>
          </div>
        ) : (
          <div className="stack-lg">
            <Section title="Panoramiche" id="body-overviews">
              <ul className="list">
                <li><RowLink href="/body/load" track="body.href" title="Carico e forma" meta="Quanto stai caricando nelle ultime 4 settimane" /></li>
                <li><RowLink href="/activities?view=trend" track="body.href-2" title="Andamento delle attività" meta="Cadenza, dinamica e ritmi delle tue corse" /></li>
              </ul>
            </Section>
            {aerobicEfficiency && (
              <Section title="Efficienza aerobica" id="body-ae">
                <AerobicEfficiencyCard data={aerobicEfficiency} animate={animate} />
              </Section>
            )}
            {correlations && (
              <Section title="Correlazioni degli ultimi 90 giorni" id="body-corr">
                <PersonalCorrelationsCard data={correlations} animate={animate} delayMs={0} />
              </Section>
            )}
            {!aerobicEfficiency && !correlations && (
              <EmptyState title="Servono più giorni di dati">
                Le tendenze compaiono dopo alcune settimane di attività e notti registrate dall’orologio.
              </EmptyState>
            )}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}

function capitalizeFirst(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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
            I dati della notte non sono ancora disponibili. Puoi aggiornare i dati o controllare la connessione Garmin.
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
    <SlideUp active={animate} delayMs={0}>
      <div className="hero" style={{ borderTop: `6px solid ${tone.stroke}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <ProgressRing value={(score ?? 0) / 100} size={92} strokeWidth={9} trackColor="rgba(255,255,255,0.7)" color={tone.stroke}>
            <div style={{ textAlign: "center", lineHeight: 1 }}>
              <p className="font-mono" style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "var(--inchiostro)" }}>{score ?? "—"}</p>
              <p className="font-mono" style={{ fontSize: 12, margin: "3px 0 0", color: "var(--inchiostro-50)" }}>su 100</p>
            </div>
          </ProgressRing>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: "var(--text-sm)", fontWeight: 600, color: tone.text, margin: 0 }}>
              {focus === "prontezza" ? "Prontezza" : "Prontezza di stamattina"}
              {score != null && ` · ${readinessBand(score).label}`}
            </p>
            <p className="display" style={{ fontWeight: 700, fontSize: "var(--text-2xl)", lineHeight: 1.1, margin: "4px 0 0" }}>
              {readinessHeadline(status, focus)}
            </p>
            {data.readiness_message && (
              <p style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "4px 0 0", lineHeight: 1.3 }}>{data.readiness_message}</p>
            )}
            <Link data-track="body.prontezza" href="/body/prontezza?from=%2Fbody" className="section-link">
              Da cosa nasce
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
              fontSize: 12,
              fontWeight: 600,
              marginTop: 10,
            }}
          >
            <AlertTriangleIcon size={12} strokeWidth={2.2} />
            <span>Dato notturno parziale</span>
            {data.overnight_reliability_note && <span style={{ fontWeight: 400, opacity: 0.85 }}>· {data.overnight_reliability_note}</span>}
          </div>
        )}
      </div>
    </SlideUp>
  );

  const heart = byKey("cuore");
  const battery = byKey("battery");
  const stress = byKey("stress");
  const rhrNorm = data.rhr_norm?.has_personal_norm ? data.rhr_norm : null;
  const vitals = (
    <div>
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
    <div>
      <SectionLabel>{focus === "prontezza" ? "La notte" : "La notte scorsa"}</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {data.sleep ? (
          <SleepCard sleep={data.sleep} animate={animate} delayMs={240} signal={byKey("sonno")} />
        ) : (
          <SlideUp active={animate} delayMs={240} style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16 }}>
            <p className="font-mono" style={{ fontSize: 12, margin: 0 }}>Sonno</p>
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
    <Notice
      tone={careful ? "warn" : "ok"}
      title={tomorrowTitle ? `Domani: ${tomorrowTitle.toLowerCase()}` : "Domani: riposo"}
    >
      {!tomorrowTitle
        ? careful
          ? "Il riposo arriva al momento giusto."
          : "Recupera e goditi la giornata."
        : careful
          ? "I valori di oggi consigliano prudenza: valuta di alleggerire. È un’indicazione, non una diagnosi."
          : "I valori sono nella norma: il piano può restare com’è."}
    </Notice>
  );

  const blocks = { readiness, vitals, night, tomorrow, nutrition };
  // A stable order: the summary first, then the numbers, the night, tomorrow. The
  // moment of the day changes the words inside each block, never where it sits.
  const order: (keyof typeof blocks)[] = ["readiness", "vitals", "night", "tomorrow", "nutrition"];
  return <>{order.map((name) => <Fragment key={name}>{blocks[name]}</Fragment>)}</>;
}

/** One out-of-range number inside the readiness card: what it is, how much, and what is
 * wrong with it, on the verdict's colour. Two to a row, so four of them stay compact. */
function SignalChip({ signal }: { signal: BodySignal }) {
  const style = STATUS_STYLE[signal.status];
  const Icon = SIGNAL_ICON[signal.key];
  return (
    <div style={{ minWidth: 0, background: style.bg, color: style.text, borderRadius: "var(--radius-sm)", padding: "8px 10px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 600 }}>
        <span aria-hidden="true" style={{ color: style.stroke, display: "inline-flex" }}><Icon size={13} /></span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{signal.label}</span>
      </span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 3, flexWrap: "wrap" }}>
        <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--inchiostro)" }}>
          {signal.value}
          {signal.unit && <span style={{ fontSize: 12, fontWeight: 400 }}> {signal.unit}</span>}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 700 }}>{signal.verdict}</span>
      </span>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="section-title" style={{ marginBottom: 10 }}>{children}</h2>;
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
    <div
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
        <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{signal?.label ?? fallbackLabel}</span>
      </span>
      <p className="font-mono" style={{ fontSize: 22, fontWeight: 600, margin: "6px 0 0", letterSpacing: "-.02em" }}>
        {signal?.value ?? "—"}
        {signal?.unit && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--inchiostro-50)" }}> {signal.unit}</span>}
      </p>
      {children}
      {signal && (
        <p style={{ fontSize: 12.5, fontWeight: 700, color: flagged ? style.text : STATUS_STYLE.ok.stroke, margin: "6px 0 0", lineHeight: 1.2 }}>{signal.verdict}</p>
      )}
    </div>
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
