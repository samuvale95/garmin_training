"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { PlanWaiting } from "@/components/PlanWaiting";
import { Illustration } from "@/components/Illustration";
import { SlideUp } from "@/components/motion/primitives";
import { formatFullDate } from "@/lib/format";
import { useAdaptation, useAdaptationCheckStartedAt, useAnswerAdaptation } from "@/lib/queries";

/** How long a check has to run before the wait is shown: most checks find nothing and
 * return in a moment, and a card flashing up for 300 ms would be noise. */
const WAIT_DELAY_MS = 1500;

/** The plan adapting to the real week (see `training_plan/plan_adaptation.py`): applied
 * with an undo in automatic mode, proposed with accept/reject otherwise. Every change
 * says why, with what the user reported or did. */
export function AdaptationCard({ animate, delayMs = 0 }: { animate: boolean; delayMs?: number }) {
  const { data } = useAdaptation();
  const checkStartedAt = useAdaptationCheckStartedAt();
  const answer = useAnswerAdaptation();

  if (checkStartedAt != null) return <DelayedWait startedAt={checkStartedAt} />;

  const adaptation = data?.adaptation;
  if (!adaptation || (adaptation.status !== "pending" && adaptation.status !== "applied")) return null;
  const pending = adaptation.status === "pending";

  return (
    <SlideUp active={animate} delayMs={delayMs} style={card}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ font: "600 16px/1.2 var(--font-outfit)", margin: 0 }}>
            {pending ? "Ti propongo di adattare il piano" : "Ho adattato il piano"}
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 0", display: "flex", flexDirection: "column", gap: 4 }}>
            {adaptation.events.map((event) => (
              <li key={`${event.kind}-${event.day}`} className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)" }}>
                {event.message}.
              </li>
            ))}
          </ul>
        </div>
        <div style={{ flexShrink: 0 }}>
          <Illustration name="scarico" size={48} />
        </div>
      </div>

      {adaptation.changes.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "12px 0 0", display: "flex", flexDirection: "column", gap: 8 }}>
          {adaptation.changes.map((change) => (
            <li key={change.date} style={{ fontSize: 13, lineHeight: 1.4 }}>
              <span className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)" }}>
                {formatFullDate(change.date)}
              </span>
              <br />
              <span style={{ textDecoration: change.after.length ? "line-through" : undefined, color: "var(--inchiostro-50)" }}>
                {change.before.join(", ") || "riposo"}
              </span>
              {" → "}
              <span style={{ fontWeight: 600 }}>{change.after.join(", ") || "riposo"}</span>
            </li>
          ))}
        </ul>
      )}

      {adaptation.conflicts.map((conflict) => (
        <p key={conflict} style={{ fontSize: 12.5, color: "var(--rosso-avviso)", margin: "10px 0 0" }}>
          {conflict}
        </p>
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {pending ? (
          <>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.03, y: -1 }}
              transition={{ type: "spring", stiffness: 450, damping: 25 }}
              style={pill(true)}
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: adaptation.id, action: "accept" })}
            >
              Accetta
            </motion.button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.94 }}
              whileHover={{ scale: 1.03, y: -1 }}
              transition={{ type: "spring", stiffness: 450, damping: 25 }}
              style={pill(false)}
              disabled={answer.isPending}
              onClick={() => answer.mutate({ id: adaptation.id, action: "reject" })}
            >
              Rifiuta
            </motion.button>
          </>
        ) : (
          <motion.button
            type="button"
            whileTap={{ scale: 0.94 }}
            whileHover={{ scale: 1.03, y: -1 }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            style={pill(false)}
            disabled={answer.isPending}
            onClick={() => answer.mutate({ id: adaptation.id, action: "undo" })}
          >
            Annulla le modifiche
          </motion.button>
        )}
      </div>
      {answer.data?.adaptation?.status === "stale" && (
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "8px 0 0" }}>
          Nel frattempo hai cambiato il piano: la proposta non vale più.
        </p>
      )}
    </SlideUp>
  );
}

/** The generation wait, shown only once the check has run for a moment. */
function DelayedWait({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  if (now - startedAt < WAIT_DELAY_MS) return null;
  return (
    <div style={{ ...card, padding: "18px 14px 14px" }}>
      <PlanWaiting startedAt={startedAt} />
    </div>
  );
}

const card: React.CSSProperties = {
  background: "var(--crema-card)",
  borderRadius: "var(--radius-card)",
  padding: 14,
  marginTop: 12,
};

function pill(primary: boolean): React.CSSProperties {
  return {
    background: primary ? "var(--inchiostro)" : "var(--sabbia-chip)",
    color: primary ? "var(--crema)" : "var(--inchiostro-70)",
    border: "none",
    borderRadius: "var(--radius-pill)",
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}
