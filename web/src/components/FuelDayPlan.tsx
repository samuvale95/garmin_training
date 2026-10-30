"use client";

import type { ReactNode } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { RunnerIcon } from "@/components/Icons";
import { capitalize } from "@/lib/format";
import { currentMoment, inHowLong, NOW_AFTER_MINUTES, portionAmount, portionsInline, toMinutes, useClockMinutes, type Moment } from "@/lib/fuelMoment";
import { habitSentence, SLOT_LABEL, type TrainingSlot } from "@/lib/trainingHabits";
import type { ComplianceLine, FuelStatus, FuelTargets, MealSlot, SessionSlot } from "@/lib/types";

const SLOT_ORDER: SessionSlot[] = ["mattina", "mezzogiorno", "pomeriggio", "sera"];

/** "Cosa mangio, e quando" -- the day's fuelling as the plates the backend already
 * sized (`nutrition.meal_plan`), placed on the clock around the session.
 *
 * The hierarchy is the point of this file. The one thing a runner opens this screen for
 * is *what to eat next*, so that is the dark card at the top, with the food in grams as
 * its headline. The rest of the day follows in the order it is eaten, the session sits
 * in it where it actually happens, and the totals -- the numbers the plates were built
 * from -- come after, as the check rather than the message.
 *
 * Every gram on screen comes from the server. The only thing worked out here is which
 * meal is "now", from the clock.
 */

// ---- the plan -------------------------------------------------------------------------

export function FuelDayPlan({
  fuel,
  status,
  narrative,
  training,
  animate,
}: {
  fuel: FuelTargets;
  status: FuelStatus | undefined;
  narrative: string | undefined;
  /** When today's session happens and where that came from (`useTrainingSlot`). */
  training: TrainingSlot;
  animate: boolean;
}) {
  const now = useClockMinutes();
  const moment = currentMoment(fuel, now);
  const trains = fuel.today.load !== "riposo";
  const focusKey = moment.kind === "meal" ? moment.meal.key : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SessionStrip fuel={fuel} training={training} animate={animate} />
      <NextMealHero fuel={fuel} moment={moment} narrative={narrative} animate={animate} />
      <DayTimeline fuel={fuel} now={now} focusKey={focusKey} trains={trains} animate={animate} />
      {/* Once the day's meals are over the top card is already about tomorrow. */}
      {moment.kind !== "done" && <TomorrowNote fuel={fuel} narrative={narrative} animate={animate} />}
      {status && status.totals.entries > 0 && <DayProgress status={status} animate={animate} />}
    </div>
  );
}

// ---- 1. when do you train -------------------------------------------------------------

function SessionStrip({ fuel, training, animate }: { fuel: FuelTargets; training: TrainingSlot; animate: boolean }) {
  const t = fuel.today;
  const rest = t.load === "riposo";
  const title = t.session_title ? capitalize(t.session_title) : rest ? "Giorno di riposo" : "Allenamento";
  const carbs = t.carb_g ? `${t.carb_g[0]}–${t.carb_g[1]} g` : null;
  const habitSlot = training.habit?.slot ?? null;
  const sentence = training.habit ? habitSentence(training.habit) : null;

  function choose(slot: SessionSlot) {
    // Picking what the habit already says is going back to automatic, not a choice
    // that should outlive today.
    training.setForToday(slot === habitSlot ? null : slot);
  }

  return (
    <SlideUp active={animate} delayMs={40}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <p className="font-mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
            Oggi
          </p>
          <p style={{ fontSize: 15, fontWeight: 700, margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</p>
        </div>
        {carbs && (
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p className="font-mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
              Carboidrati
            </p>
            <p className="font-mono" style={{ fontSize: 14, fontWeight: 700, margin: "2px 0 0" }}>{carbs}</p>
          </div>
        )}
      </div>

      {!rest && (
        <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, margin: "0 0 6px" }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--inchiostro-70)", margin: 0 }}>Quando ti alleni oggi?</p>
            {training.source === "abitudine" && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--verde-testo)", background: "var(--verde)", borderRadius: "var(--radius-pill)", padding: "2px 8px" }}>
                automatico
              </span>
            )}
            {training.source === "oggi" && (
              <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--inchiostro-70)", background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "2px 8px" }}>
                solo per oggi
              </span>
            )}
          </div>
          <div role="radiogroup" aria-label="Quando ti alleni oggi" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4, background: "var(--sabbia)", padding: 4, borderRadius: 14 }}>
            {SLOT_ORDER.map((slot) => {
              const active = slot === training.slot;
              return (
                <button
                  key={slot}
                  data-track={`nutrition.orario-${slot}`}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => choose(slot)}
                  className="tap-target"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 1,
                    border: "none",
                    borderRadius: 11,
                    padding: "7px 2px",
                    minHeight: 44,
                    fontSize: 12,
                    fontWeight: 600,
                    lineHeight: 1.15,
                    cursor: "pointer",
                    background: active ? "var(--crema)" : "transparent",
                    color: active ? "var(--inchiostro)" : "var(--inchiostro-70)",
                    boxShadow: active ? "0 2px 6px rgba(0,0,0,.07)" : "none",
                    transition: "background .15s var(--ease)",
                  }}
                >
                  <span>{SLOT_LABEL[slot]}</span>
                  {active && fuel.session_clock && (
                    <span className="font-mono" style={{ fontSize: 10.5, color: "var(--inchiostro-50)" }}>{fuel.session_clock}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 12, lineHeight: 1.4, color: "var(--inchiostro-50)", margin: "6px 2px 0" }}>
            {training.source === "abitudine" && sentence
              ? `${sentence} I pasti sono messi in base a questo.`
              : training.source === "oggi"
                ? sentence
                  ? `${sentence} Domani torno a usare il tuo orario abituale.`
                  : "Domani torno a chiedertelo."
                : "Non ho ancora abbastanza allenamenti registrati per capire il tuo orario: sceglilo tu."}
          </p>
        </div>
      )}
    </SlideUp>
  );
}

// ---- 2. the hint: what to eat now -----------------------------------------------------

function NextMealHero({
  fuel,
  moment,
  narrative,
  animate,
}: {
  fuel: FuelTargets;
  moment: Moment;
  narrative: string | undefined;
  animate: boolean;
}) {
  const card = {
    background: "var(--inchiostro)",
    color: "var(--crema)",
    borderRadius: "var(--radius-card-lg)",
    padding: "20px 20px 18px",
    boxShadow: "var(--shadow-airbnb-card)",
  } as const;

  if (moment.kind === "session") {
    const during = fuel.during;
    const after = fuel.meals.find((meal) => meal.role === "post");
    return (
      <SlideUp active={animate} delayMs={80} style={card}>
        <HeroOverline accent>Allenamento previsto · dalle {fuel.session_clock}</HeroOverline>
        <p style={{ font: "700 22px/1.2 var(--font-outfit)", letterSpacing: "-.02em", margin: "10px 0 0" }}>
          {during ? `${during.carb_g_per_hour[0]}–${during.carb_g_per_hour[1]} g di carboidrati all'ora` : "Solo acqua"}
        </p>
        <p style={{ fontSize: 14.5, lineHeight: 1.4, color: "var(--inchiostro-su-scuro)", margin: "8px 0 0" }}>
          {during ? capitalize(during.note) : "Per questa seduta basta l'acqua: bevi a sete, mangi dopo."}
        </p>
        {after && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.12)" }}>
            <p className="font-mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)", margin: 0 }}>
              Dopo · alle {after.clock}
            </p>
            <p style={{ fontSize: 16, fontWeight: 600, margin: "6px 0 0" }}>{after.name}</p>
            {after.portions.length > 0 && (
              <p style={{ fontSize: 13.5, lineHeight: 1.4, color: "var(--inchiostro-su-scuro)", margin: "4px 0 0" }}>{portionsInline(after.portions)}</p>
            )}
          </div>
        )}
      </SlideUp>
    );
  }

  if (moment.kind === "done") {
    const tomorrow = fuel.tomorrow;
    const tomorrowTitle = tomorrow.session_title ? capitalize(tomorrow.session_title) : tomorrow.load === "riposo" ? "riposo" : "allenamento";
    return (
      <SlideUp active={animate} delayMs={80} style={card}>
        <HeroOverline>Per oggi i pasti sono finiti</HeroOverline>
        <p style={{ font: "700 22px/1.2 var(--font-outfit)", letterSpacing: "-.02em", margin: "10px 0 0" }}>Domani: {tomorrowTitle}</p>
        <p style={{ fontSize: 14.5, lineHeight: 1.4, color: "var(--inchiostro-su-scuro)", margin: "8px 0 0" }}>{narrative ?? fuel.advice}</p>
      </SlideUp>
    );
  }

  const { meal } = moment;
  const when = moment.now ? "Adesso" : moment.minutesUntil != null ? `Prossimo · ${inHowLong(moment.minutesUntil)}` : "Prossimo pasto";
  const roleLabel = meal.role === "pre" ? "prima dell'allenamento" : meal.role === "post" ? "recupero" : null;

  return (
    <SlideUp active={animate} delayMs={80} style={card}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <HeroOverline accent={moment.now}>{when}</HeroOverline>
        {roleLabel && (
          <span style={{ fontSize: 11, fontWeight: 700, background: "var(--corallo-accent)", color: "#fff", borderRadius: "var(--radius-pill)", padding: "3px 10px", whiteSpace: "nowrap" }}>
            {roleLabel}
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginTop: 10 }}>
        <h2 style={{ font: "700 26px/1.1 var(--font-outfit)", letterSpacing: "-.025em", margin: 0 }}>{meal.name}</h2>
        <span className="font-mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--inchiostro-su-scuro)", flexShrink: 0 }}>{meal.clock}</span>
      </div>

      {meal.portions.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "16px 0 0", display: "flex", flexDirection: "column", gap: 2 }}>
          {meal.portions.map((portion) => {
            const amount = portionAmount(portion);
            return (
              <li
                key={portion.food}
                style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.1)" }}
              >
                <span style={{ fontSize: 17, fontWeight: 600 }}>{capitalize(portion.food)}</span>
                {amount && (
                  <span className="font-mono" style={{ fontSize: 15, fontWeight: 600, color: "var(--crema)", whiteSpace: "nowrap" }}>
                    {amount}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {meal.note && (
        <p style={{ fontSize: 14, lineHeight: 1.4, color: "var(--inchiostro-su-scuro)", margin: "12px 0 0" }}>{capitalize(meal.note)}</p>
      )}

      <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)", margin: "12px 0 0" }}>
        ≈ {meal.carb_g} g carboidrati · {meal.protein_g} g proteine
      </p>
    </SlideUp>
  );
}

function HeroOverline({ children, accent = false }: { children: ReactNode; accent?: boolean }) {
  return (
    <span
      className="font-mono"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: ".07em",
        textTransform: "uppercase",
        color: accent ? "#ff8fa6" : "var(--inchiostro-su-scuro)",
      }}
    >
      {accent && <span aria-hidden="true" style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff8fa6" }} />}
      {children}
    </span>
  );
}

// ---- 3. the rest of the day, in order -------------------------------------------------

function DayTimeline({
  fuel,
  now,
  focusKey,
  trains,
  animate,
}: {
  fuel: FuelTargets;
  now: number | null;
  focusKey: string | null;
  trains: boolean;
  animate: boolean;
}) {
  const sessionAt = toMinutes(fuel.session_clock);
  type Row = { kind: "meal"; meal: MealSlot; at: number } | { kind: "session"; at: number };
  const rows: Row[] = fuel.meals.map((meal) => ({ kind: "meal" as const, meal, at: toMinutes(meal.clock) ?? 0 }));
  if (trains && sessionAt != null) rows.push({ kind: "session", at: sessionAt });
  rows.sort((a, b) => a.at - b.at);

  if (rows.length === 0) return null;

  return (
    <SlideUp active={animate} delayMs={140}>
      <p className="font-mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: "8px 0 10px 2px" }}>
        La giornata
      </p>
      <ol style={{ listStyle: "none", padding: 0, margin: 0, position: "relative" }}>
        {/* the rail */}
        <span aria-hidden="true" style={{ position: "absolute", left: 51, top: 10, bottom: 10, width: 2, background: "var(--sabbia-bordo)", borderRadius: 1 }} />
        {rows.map((row) => {
          if (row.kind === "session") {
            return <SessionRow key="session" fuel={fuel} past={now != null && now > row.at + (fuel.today.duration_minutes ?? 60)} />;
          }
          const past = now != null && row.meal.key !== focusKey && now >= row.at + NOW_AFTER_MINUTES;
          return <MealRowItem key={row.meal.key} meal={row.meal} focus={row.meal.key === focusKey} past={past} />;
        })}
      </ol>
    </SlideUp>
  );
}

function TimelineClock({ clock, strong }: { clock: string | null; strong: boolean }) {
  return (
    <span className="font-mono" style={{ width: 42, flexShrink: 0, fontSize: 12.5, fontWeight: strong ? 700 : 500, color: strong ? "var(--inchiostro)" : "var(--inchiostro-50)", paddingTop: 2 }}>
      {clock}
    </span>
  );
}

function TimelineDot({ color, ring = false }: { color: string; ring?: boolean }) {
  return (
    <span style={{ width: 20, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 5, position: "relative", zIndex: 1 }}>
      <span
        style={{
          width: ring ? 12 : 9,
          height: ring ? 12 : 9,
          borderRadius: "50%",
          background: color,
          boxShadow: ring ? `0 0 0 4px var(--corallo-chiaro)` : "0 0 0 3px var(--crema)",
        }}
      />
    </span>
  );
}

function MealRowItem({ meal, focus, past }: { meal: MealSlot; focus: boolean; past: boolean }) {
  const roleColor = meal.role ? "var(--corallo-accent)" : "var(--inchiostro-35)";
  return (
    <li style={{ display: "flex", gap: 0, padding: "0 0 12px", opacity: past ? 0.5 : 1 }}>
      <TimelineClock clock={meal.clock} strong={focus} />
      <TimelineDot color={focus ? "var(--corallo-accent)" : roleColor} ring={focus} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          marginLeft: 8,
          background: focus ? "var(--corallo-chiaro)" : "var(--crema-card)",
          border: focus ? "1px solid var(--corallo)" : "var(--border-airbnb)",
          borderRadius: 16,
          padding: "11px 13px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 14.5, fontWeight: 700 }}>
            {meal.name}
            {meal.role === "pre" && <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--corallo-accent)", marginLeft: 6 }}>{meal.timing}</span>}
          </span>
          <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", whiteSpace: "nowrap" }}>
            {meal.carb_g} g C
          </span>
        </div>
        {meal.portions.length > 0 && (
          <p style={{ fontSize: 13.5, lineHeight: 1.4, color: "var(--inchiostro-70)", margin: "4px 0 0" }}>{portionsInline(meal.portions)}</p>
        )}
        {meal.note && !past && (
          <p style={{ fontSize: 12.5, lineHeight: 1.35, color: meal.role ? "var(--corallo-testo)" : "var(--inchiostro-50)", margin: "5px 0 0" }}>
            {capitalize(meal.note)}
          </p>
        )}
      </div>
    </li>
  );
}

function SessionRow({ fuel, past }: { fuel: FuelTargets; past: boolean }) {
  const t = fuel.today;
  const title = t.session_title ? capitalize(t.session_title) : "Allenamento";
  const minutes = t.duration_minutes ? `${Math.round(t.duration_minutes)} min` : null;
  const during = fuel.during;
  return (
    <li style={{ display: "flex", padding: "0 0 12px", opacity: past ? 0.5 : 1 }}>
      <TimelineClock clock={fuel.session_clock} strong={false} />
      <span style={{ width: 20, flexShrink: 0, display: "flex", justifyContent: "center", paddingTop: 1, position: "relative", zIndex: 1, color: "var(--corallo-accent)" }}>
        <RunnerIcon size={16} strokeWidth={2.2} style={{ background: "var(--crema)", borderRadius: 4 }} />
      </span>
      <div style={{ flex: 1, minWidth: 0, marginLeft: 8, border: "1.5px dashed var(--corallo-accent)", borderRadius: 16, padding: "10px 13px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: "var(--corallo-testo)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {minutes && <span className="font-mono" style={{ fontSize: 11.5, color: "var(--corallo-testo)", whiteSpace: "nowrap" }}>{minutes}</span>}
        </div>
        <p style={{ fontSize: 13, lineHeight: 1.35, color: "var(--corallo-testo)", margin: "4px 0 0" }}>
          {during
            ? `Durante: ${during.carb_g_per_hour[0]}–${during.carb_g_per_hour[1]} g/h (in tutto ${during.total_carb_g[0]}–${during.total_carb_g[1]} g). ${capitalize(during.note)}.`
            : "Durante: solo acqua."}
        </p>
      </div>
    </li>
  );
}

// ---- 4. tomorrow ----------------------------------------------------------------------

function TomorrowNote({ fuel, narrative, animate }: { fuel: FuelTargets; narrative: string | undefined; animate: boolean }) {
  const t = fuel.tomorrow;
  const hard = t.load === "duro" || t.load === "molto_lungo";
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Riposo" : "Allenamento";
  return (
    <SlideUp
      active={animate}
      delayMs={200}
      style={{
        background: hard ? "var(--corallo-chiaro)" : "var(--crema-card)",
        border: hard ? "1px solid var(--corallo)" : "var(--border-airbnb)",
        borderRadius: 18,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span className="font-mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: hard ? "var(--corallo-testo)" : "var(--inchiostro-50)" }}>
          Domani · {title}
        </span>
        {t.carb_g && (
          <span className="font-mono" style={{ fontSize: 12, fontWeight: 700, color: hard ? "var(--corallo-testo)" : "var(--inchiostro-70)", whiteSpace: "nowrap" }}>
            {t.carb_g[0]}–{t.carb_g[1]} g C
          </span>
        )}
      </div>
      <p style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--inchiostro)", margin: "6px 0 0" }}>{narrative ?? fuel.advice}</p>
    </SlideUp>
  );
}

// ---- 5. so far today ------------------------------------------------------------------

const MACRO_LABEL: Record<ComplianceLine["macro"], string> = { carb: "Carboidrati", protein: "Proteine", fat: "Grassi" };

function DayProgress({ status, animate }: { status: FuelStatus; animate: boolean }) {
  const lines = status.lines.filter((line) => line.macro !== "fat");
  const flagged = status.lines.find((line) => line.flagged);
  return (
    <SlideUp active={animate} delayMs={240} style={{ background: "var(--crema-card)", border: "var(--border-airbnb)", borderRadius: 18, padding: "14px 16px" }}>
      <p className="font-mono" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: "0 0 10px" }}>
        Finora oggi
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lines.map((line) => {
          const top = (line.target_g && line.target_g[1]) || 1;
          const fill = Math.min(1, line.logged_g / top);
          const low = (line.target_g ? line.target_g[0] : 0) / top;
          const color = line.status === "sotto" ? (line.flagged ? "var(--corallo-accent)" : "var(--inchiostro-35)") : "var(--verde-tratto-scuro)";
          return (
            <div key={line.macro}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{MACRO_LABEL[line.macro] ?? line.macro}</span>
                <span className="font-mono" style={{ color: "var(--inchiostro-70)" }}>
                  {Math.round(line.logged_g)} / {line.target_g ? `${line.target_g[0]}–${line.target_g[1]} g` : "—"}
                </span>
              </div>
              <div style={{ position: "relative", height: 6, background: "var(--sabbia)", borderRadius: 3, overflow: "hidden" }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${fill * 100}%`, background: color, borderRadius: 3 }} />
                <span aria-hidden="true" style={{ position: "absolute", left: `${low * 100}%`, top: 0, bottom: 0, width: 2, background: "var(--inchiostro-35)" }} />
              </div>
            </div>
          );
        })}
      </div>
      {flagged && (
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--corallo-testo)", margin: "10px 0 0" }}>
          {capitalize(flagged.message)}
        </p>
      )}
    </SlideUp>
  );
}
