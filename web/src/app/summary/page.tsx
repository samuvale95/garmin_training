"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useWeekSummary, useWeekSummaryNarrative } from "@/lib/queries";
import { shiftDateKey, toDateKey } from "@/lib/sessionVisuals";
import { formatWeekday } from "@/lib/format";
import type { CheckInEffort, WeekSummary } from "@/lib/types";

const EFFORT_LABELS: [CheckInEffort, string][] = [
  ["facile", "facili"],
  ["giusta", "giuste"],
  ["dura", "dure"],
  ["troppo", "troppo dure"],
];

function rangeLabel(monday: string, sunday: string): string {
  const start = new Date(`${monday}T00:00:00`);
  const end = new Date(`${sunday}T00:00:00`);
  const month = (d: Date) => d.toLocaleDateString("it-IT", { month: "short" });
  return month(start) === month(end)
    ? `${start.getDate()} – ${end.getDate()} ${month(end)}`
    : `${start.getDate()} ${month(start)} – ${end.getDate()} ${month(end)}`;
}

function thisMonday(): string {
  const today = new Date();
  return shiftDateKey(toDateKey(today), -((today.getDay() + 6) % 7));
}

/** "La tua settimana": what was planned, what was done, how it felt, whether the habit
 * holds (see `training_plan/weekly_summary.py`). Every figure is a count the user can
 * redo from their own calendar; only the sentence under the headline is a model's. */
function SummaryContent() {
  const animate = useMountOnce("summary");
  const [monday, setMonday] = useState<string | null>(useSearchParams().get("monday"));
  const summary = useWeekSummary(monday);
  const shown = summary.data?.monday ?? monday;
  const narrative = useWeekSummaryNarrative(shown, !!shown);
  const canGoForward = !!shown && shown < thisMonday();

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/today" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>resoconto</span>
      </div>

      <WordIn active={animate} as="h1" style={{ font: "600 30px/1.06 var(--font-outfit)", letterSpacing: "-.03em", margin: "16px 0 4px" }}>
        La tua settimana
      </WordIn>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <NavButton label="Settimana precedente" disabled={!shown} onClick={() => shown && setMonday(shiftDateKey(shown, -7))}>
          ‹
        </NavButton>
        <span className="font-mono" style={{ fontSize: 13, color: "var(--inchiostro-70)", minWidth: 120, textAlign: "center" }}>
          {summary.data ? rangeLabel(summary.data.monday, summary.data.sunday) : "…"}
        </span>
        <NavButton label="Settimana successiva" disabled={!canGoForward} onClick={() => shown && setMonday(shiftDateKey(shown, 7))}>
          ›
        </NavButton>
      </div>

      {summary.isPending ? (
        <Skeleton height={180} radius={27} />
      ) : summary.isError || !summary.data ? (
        <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)" }}>
          Non sono riuscito a leggere la settimana. Riprova fra un momento.
        </p>
      ) : (
        <SummaryBody data={summary.data} narrative={narrative.data?.source === "model" ? narrative.data.text : null} animate={animate} />
      )}
    </div>
  );
}

function SummaryBody({ data, narrative, animate }: { data: WeekSummary; narrative: string | null; animate: boolean }) {
  const planFigure =
    data.planned_days_trained != null && data.planned_days > 0
      ? { label: "Giorni del piano", value: `${data.planned_days_trained}/${data.planned_days}` }
      : { label: "Allenamenti", value: String(data.done_sessions) };
  const efforts = EFFORT_LABELS.filter(([key]) => data.efforts[key]);

  return (
    <>
      <SlideUp active={animate} delayMs={80} style={{ background: "var(--inchiostro)", color: "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 22 }}>
        <p style={{ font: "600 20px/1.25 var(--font-outfit)", margin: 0 }}>{data.headline}</p>
        {narrative && (
          <p className="font-serif-italic" style={{ fontSize: 15, lineHeight: 1.4, margin: "12px 0 0" }}>
            {narrative}
          </p>
        )}
        {!data.complete && (
          <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: "12px 0 0" }}>
            settimana in corso
          </p>
        )}
      </SlideUp>

      <div style={{ display: "flex", gap: 9, marginTop: 12 }}>
        <Figure label={planFigure.label} value={planFigure.value} />
        <Figure label="Minuti di corsa" value={String(data.done_minutes)} />
        <Figure label="Settimane di fila" value={String(data.streak_weeks)} accent />
      </div>

      {data.highlights.length > 0 && (
        <SlideUp active={animate} delayMs={160} style={{ marginTop: 16 }}>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {data.highlights.map((line) => (
              <li key={line} style={{ fontSize: 14, lineHeight: 1.4, paddingLeft: 14, position: "relative" }}>
                <span aria-hidden="true" style={{ position: "absolute", left: 0, top: 8, width: 6, height: 6, borderRadius: "50%", background: "var(--corallo)" }} />
                {line}
              </li>
            ))}
          </ul>
        </SlideUp>
      )}

      <SlideUp active={animate} delayMs={220} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 16 }}>
        <p style={{ font: "500 11.5px var(--font-outfit)", color: "var(--inchiostro-50)", margin: 0 }}>Sensazioni</p>
        {data.checkin_days === 0 ? (
          <p style={{ fontSize: 13.5, margin: "6px 0 0", color: "var(--inchiostro-70)" }}>
            Nessun check-in questa settimana: bastano due tocchi dopo l&apos;allenamento, su Oggi.
          </p>
        ) : (
          <>
            <p style={{ fontSize: 14, margin: "6px 0 0" }}>
              {efforts.length > 0
                ? efforts.map(([key, label]) => `${data.efforts[key]} ${label}`).join(" · ")
                : "Nessuna seduta valutata"}
            </p>
            {data.pain_days.map((pain) => (
              <p key={pain.date} style={{ fontSize: 13, margin: "6px 0 0", color: "var(--rosso-avviso)" }}>
                Dolore {pain.area ? `(${pain.area})` : ""} {formatWeekday(pain.date)}
              </p>
            ))}
            <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>
              {data.checkin_days} {data.checkin_days === 1 ? "giorno" : "giorni"} con check-in
            </p>
          </>
        )}
      </SlideUp>

      {data.next_week && (
        <SlideUp active={animate} delayMs={280} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 12 }}>
          <p style={{ font: "500 11.5px var(--font-outfit)", color: "var(--inchiostro-50)", margin: 0 }}>La prossima settimana</p>
          <p style={{ fontSize: 14, lineHeight: 1.45, margin: "6px 0 0" }}>
            {data.next_week.reason ??
              `${data.next_week.planned_sessions} sedute in piano, ${data.next_week.planned_minutes} minuti di corsa.`}
          </p>
        </SlideUp>
      )}
    </>
  );
}

function Figure({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ flex: 1, background: accent ? "var(--corallo)" : "var(--crema-card)", color: accent ? "var(--corallo-testo)" : undefined, borderRadius: "var(--radius-card)", padding: 13 }}>
      <p style={{ font: "500 11px var(--font-outfit)", opacity: 0.7, margin: 0 }}>{label}</p>
      <p style={{ font: "600 24px/1 var(--font-outfit)", letterSpacing: "-.03em", margin: "8px 0 0" }}>{value}</p>
    </div>
  );
}

function NavButton({ label, disabled, onClick, children }: { label: string; disabled: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="tap-target press-soft"
      style={{ width: 30, height: 30, borderRadius: "50%", border: "none", background: "var(--sabbia-chip)", color: "var(--inchiostro)", opacity: disabled ? 0.35 : 1, cursor: disabled ? "default" : "pointer", fontSize: 15 }}
    >
      {children}
    </button>
  );
}

export default function SummaryPage() {
  return (
    <Suspense fallback={null}>
      <SummaryContent />
    </Suspense>
  );
}
