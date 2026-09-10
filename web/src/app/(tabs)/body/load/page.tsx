"use client";

import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { numberToItalianWords } from "@/lib/format";
import { useBodyLoad, usePlanQuery } from "@/lib/queries";
import { isoWeekNumber, sessionDistanceKm, toDateKey } from "@/lib/sessionVisuals";
import { countdownLabel, goalTitle } from "@/lib/raceGoal";

const ROW_HEIGHT = 100;

/** A week as the chart draws it: what Garmin recorded ("fatto", null for a week not
 * run yet) alongside what the plan asks for ("previsto"). */
interface ChartWeek {
  week_start: string;
  completed_load: number | null;
  in_progress: boolean;
  plannedKm: number;
}

function loadState(ratio: number | null): { label: string; caption: string } {
  if (ratio == null) return { label: "—", caption: "" };
  if (ratio > 1.5) return { label: "A rischio", caption: "il carico sale troppo in fretta" };
  if (ratio > 1.1) return { label: "Produttivo", caption: "il carico paga: forma in salita" };
  if (ratio >= 0.8) return { label: "Mantenimento", caption: "il carico regge la forma attuale" };
  return { label: "In calo", caption: "il carico è sceso, la forma può calare" };
}

/** The charted weeks the plan actually reaches: the trailing ones it says nothing
 * about are dropped. Those are the two "previsto" weeks appended past the end of a
 * file -- an empty bar there means the plan stops, not a rest week, and reading it as
 * one is how a caption ends up announcing a −100% scarico that nobody planned. */
function coveredWeeks(weeks: ChartWeek[]): ChartWeek[] {
  const lastCovered = weeks.reduce((last, w, i) => (w.plannedKm > 0 ? i + 1 : last), 0);
  return weeks.slice(0, lastCovered);
}

/** Everything the screen says in prose, counted off the weeks it actually draws.
 *
 * This copy used to be fixed -- "Stai salendo", "Tre settimane in crescita e una di
 * scarico in arrivo" -- and stayed on screen whatever the numbers said, so it was
 * wrong for anyone whose plan wasn't the one the mockup was drawn from. Nothing is
 * claimed here that isn't read out of `weeks`.
 *
 * The trend comes off the planned series: it exists for every week, including the
 * ones not run yet, and it is the plan's own shape -- which is what this screen is
 * about. The completed series can't carry it, being Garmin's training-load score
 * rather than kilometres. A trailing deload week is held out of the streak and called
 * out separately: a scarico is the plan working, not the trend reversing. */
function loadStory(weeks: ChartWeek[]): {
  headline: string;
  caption: string;
  deload: { weekStart: string; dropPct: number } | null;
} {
  const covered = coveredWeeks(weeks);

  // A last week meaningfully lighter than the ones before it is the plan's scarico.
  const prior = covered.slice(0, -1);
  const last = covered[covered.length - 1];
  const avgPrior = prior.reduce((sum, w) => sum + w.plannedKm, 0) / (prior.length || 1);
  const deload =
    last && avgPrior > 0 && last.plannedKm < avgPrior * 0.7
      ? { weekStart: last.week_start, dropPct: Math.round((1 - last.plannedKm / avgPrior) * 100) }
      : null;

  const planned = (deload ? prior : covered).map((w) => w.plannedKm);

  if (planned.length < 2) {
    return {
      headline: "Ancora poco da leggere",
      caption: "Servono un paio di settimane di piano prima che l'andamento del carico voglia dire qualcosa.",
      deload,
    };
  }

  // Length of the run of weeks at the end that keep moving the same way. A 5% band
  // counts as flat: two weeks apart by 300 m are the same week, not a trend.
  const direction = (a: number, b: number) => (b > a * 1.05 ? 1 : b < a * 0.95 ? -1 : 0);
  const lastDirection = direction(planned[planned.length - 2], planned[planned.length - 1]);
  let streak = 0;
  for (let i = planned.length - 1; i > 0 && direction(planned[i - 1], planned[i]) === lastDirection; i--) streak++;

  const trend =
    lastDirection === 1
      ? { headline: "Stai salendo", phrase: `${numberToItalianWords(streak + 1)} settimane in crescita` }
      : lastDirection === -1
        ? { headline: "Stai calando", phrase: `${numberToItalianWords(streak + 1)} settimane in calo` }
        : { headline: "Sei stabile", phrase: "il volume tiene la stessa quota" };

  const scarico = deload ? ` e una di scarico in arrivo, −${deload.dropPct}%` : "";
  return {
    headline: trend.headline,
    caption: `${trend.phrase}${scarico}. È la forma che il tuo file disegna.`,
    deload,
  };
}

/** The italic line under the acute:chronic dial. 0.8-1.3 is the commonly cited
 * comfortable band; outside it the line says which side, and never that being
 * outside it is fine -- which is what the previous fixed copy said, unconditionally. */
function acwrNote(ratio: number | null): string {
  if (ratio == null) return "Garmin non ha ancora un rapporto acuto su cronico per queste settimane.";
  if (ratio > 1.5) return "Molto sopra la fascia comoda (0,8–1,3): è la zona in cui il rischio di infortunio sale.";
  if (ratio > 1.3) return "Sopra la fascia comoda (0,8–1,3). Ci si passa in un blocco di costruzione, non ci si resta.";
  if (ratio >= 0.8) return "Dentro la fascia comoda (0,8–1,3): il carico recente è in linea con la tua media.";
  return "Sotto la fascia comoda (0,8–1,3): stai facendo meno della tua media delle ultime settimane.";
}

export default function LoadPage() {
  const animate = useMountOnce("body-load");
  const { data, isLoading } = useBodyLoad();
  // The plan drives every "previsto" bar and the whole trend story, so the screen waits
  // for it to come back out of localStorage too: reading it before hydration would show
  // a plan-less "ancora poco da leggere" for a beat, to someone who has a plan.
  const { data: plan, isHydrated } = usePlanQuery();
  const isPending = isLoading || !isHydrated;

  function plannedKmForWeek(start: Date): number {
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return (plan?.sessions ?? [])
      .filter((s) => s.date >= toDateKey(start) && s.date <= toDateKey(end))
      .reduce((sum, s) => sum + sessionDistanceKm(s), 0);
  }

  const pastWeeks = (data?.weeks ?? []).map((week) => ({
    ...week,
    plannedKm: plannedKmForWeek(new Date(week.week_start)),
  }));

  // Garmin only ever reports completed/in-progress weeks -- the design's chart also
  // shows the plan's next couple of weeks ("previsto") with no "fatto" bar yet, so
  // those are appended purely from the client-side plan, never from the backend.
  const futureWeeks: ChartWeek[] = [];
  if (pastWeeks.length > 0) {
    const lastStart = new Date(pastWeeks[pastWeeks.length - 1].week_start);
    for (let i = 1; i <= 2; i++) {
      const start = new Date(lastStart);
      start.setDate(lastStart.getDate() + 7 * i);
      futureWeeks.push({ week_start: toDateKey(start), completed_load: null, in_progress: false, plannedKm: plannedKmForWeek(start) });
    }
  }

  const weeks: ChartWeek[] = [...pastWeeks, ...futureWeeks];

  // Each series is scaled against its own maximum, never against the other's. The two
  // are different quantities that only look comparable: "fatto" is Garmin's acute
  // training-load score (a unitless number in the hundreds), "previsto" is kilometres
  // off the plan. Sharing one axis made a normal week's load tower over the planned
  // bar next to it and turned the pair into a comparison that means nothing. Each bar
  // now says "this week against your biggest week in *this* series", which is the only
  // reading the data supports.
  const maxLoad = Math.max(1, ...weeks.map((w) => w.completed_load ?? 0));
  const maxPlanned = Math.max(1, ...weeks.map((w) => w.plannedKm));

  const { headline, caption, deload } = loadStory(weeks);
  const plannedAhead = futureWeeks.reduce((sum, w) => sum + w.plannedKm, 0);

  return (
    <div style={{ padding: "22px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader backHref="/body" />
          <BrandMark height={22} />
        </div>
        <span style={{ fontSize: 11, color: "var(--inchiostro-35)", fontWeight: 500 }}>
          {weeks.length > 0 ? `carico · ${weeks.length} settimane` : "carico"}
        </span>
      </div>

      {isPending ? (
        <p style={{ marginTop: 14 }}>Carico i dati…</p>
      ) : (
        <>
          <div style={{ marginTop: 14 }}>
            <WordIn active={animate} style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>{headline}</WordIn>
          </div>
          <p className="font-serif-italic" style={{ fontSize: 15.5, color: "var(--inchiostro-70)" }}>{caption}</p>

          {/* Where this sits relative to the race, when the plan states one. A label on
              the calendar, not a verdict on the shape above it -- the two are computed
              from different things and are allowed to disagree. */}
          {plan?.goal && plan.goal.phase !== "gara passata" && (
            <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>
              {goalTitle(plan.goal)} {countdownLabel(plan.goal)}
              {plan.goal.phase && ` · ${plan.goal.phase}`}
            </p>
          )}

          <SlideUp
            active={animate}
            delayMs={150}
            style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 10 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, marginBottom: 10 }}>
              <Legend color="var(--corallo)" label="fatto · carico" />
              <Legend color="var(--sabbia-bordo)" label="previsto · km" />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: ROW_HEIGHT }}>
              {weeks.map((week) => {
                const completedPx = Math.round(((week.completed_load ?? 0) / maxLoad) * ROW_HEIGHT);
                const plannedPx = Math.round((week.plannedKm / maxPlanned) * ROW_HEIGHT);
                return (
                  <div key={week.week_start} style={{ flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 3, height: ROW_HEIGHT }}>
                    <div
                      className={week.in_progress ? "anim-bar-settle" : undefined}
                      style={{ width: "45%", height: completedPx, background: "var(--corallo)", borderRadius: "4px 4px 0 0", transformOrigin: "bottom" }}
                    />
                    <div style={{ width: "45%", height: plannedPx, background: "var(--sabbia-bordo)", borderRadius: "4px 4px 0 0" }} />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              {weeks.map((week) => {
                const weekNumber = isoWeekNumber(new Date(week.week_start));
                return (
                  <p
                    key={week.week_start}
                    className="font-mono"
                    style={{ flex: 1, textAlign: "center", fontSize: 11, color: week.in_progress ? "var(--inchiostro)" : "var(--inchiostro-50)", fontWeight: week.in_progress ? 700 : 400, margin: 0 }}
                  >
                    {weekNumber}
                  </p>
                );
              })}
            </div>
            <p style={{ fontSize: 11, color: "var(--inchiostro-35)", marginTop: 10 }}>
              Due scale diverse: il carico è il punteggio di Garmin, il previsto sono i km del piano. Ogni
              serie è alta rispetto alla propria settimana migliore.
            </p>
            {deload && (
              <p style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 6 }}>
                settimana {isoWeekNumber(new Date(deload.weekStart))} è lo scarico: −{deload.dropPct}% di km previsti
              </p>
            )}
          </SlideUp>

          <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
            <SlideUp active={animate} delayMs={250} style={{ flex: 1, background: "var(--verde)", color: "var(--verde-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: "0 0 4px" }}>Stato</p>
              <p style={{ font: "600 18px/1 var(--font-outfit)", margin: 0 }}>{loadState(data?.acute_chronic_ratio ?? null).label}</p>
              <p style={{ fontSize: 11, margin: "6px 0 0" }}>{loadState(data?.acute_chronic_ratio ?? null).caption}</p>
            </SlideUp>
            <SlideUp active={animate} delayMs={280} style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: "0 0 4px", color: "var(--inchiostro-50)" }}>VO₂ max</p>
              <p className="font-mono" style={{ fontSize: 20, margin: 0 }}>{data?.vo2max ?? "—"}</p>
            </SlideUp>
          </div>

          <SlideUp active={animate} delayMs={320} style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 9 }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
              <p style={{ fontSize: 11, textTransform: "uppercase", margin: 0 }}>Acuto su cronico</p>
              <p className="font-mono" style={{ fontSize: 18, margin: 0 }}>{data?.acute_chronic_ratio?.toFixed(2) ?? "—"}</p>
            </div>
            {data?.acute_chronic_ratio != null && (
              <div style={{ position: "relative", height: 4, borderRadius: 100, background: "rgba(31,51,16,.15)", marginTop: 12 }}>
                <div
                  style={{
                    position: "absolute",
                    top: -3,
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: "var(--giallo-testo)",
                    left: `calc(${Math.min(100, Math.max(0, (data.acute_chronic_ratio / 2) * 100))}% - 5px)`,
                  }}
                />
              </div>
            )}
            <p className="font-serif-italic" style={{ fontSize: 13, margin: "12px 0 0" }}>
              {acwrNote(data?.acute_chronic_ratio ?? null)}
            </p>
          </SlideUp>

          {plannedAhead > 0 && (
            <SlideUp active={animate} delayMs={380} className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", marginTop: 14 }}>
              Nelle prossime due settimane il file chiede {plannedAhead.toFixed(0)} km.
            </SlideUp>
          )}
        </>
      )}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--inchiostro-50)" }}>
      <span style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
