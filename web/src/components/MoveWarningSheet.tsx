"use client";

import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";
import { Illustration } from "@/components/Illustration";
import { EVIDENCE_LABELS, clearPendingMove, recordMoveDecision, usePendingMove } from "@/lib/moveWarnings";
import { useUpdateSession } from "@/lib/queries";
import { formatFullDate } from "@/lib/format";

/** The warning after a risky move (§0.5 of the brainstorming): what the rule is, with the
 * user's own sessions, and three answers. Never a block: "Confermo" keeps the move as
 * made, and the same sequence will not warn again. */
export function MoveWarningSheet() {
  const move = usePendingMove();
  const updateSession = useUpdateSession();
  const { reduced } = useMotionEnabled();
  if (!move) return null;

  const { adapted } = move.check;

  function answer(choice: "confermo" | "adatta" | "annulla") {
    if (!move) return;
    if (choice === "adatta" && adapted) {
      updateSession(move.sessionId, (s) => ({ ...s, title: adapted.title, description: adapted.description, steps: adapted.steps, date: move.to }));
    } else if (choice === "annulla") {
      updateSession(move.sessionId, (s) => ({ ...s, date: move.from }));
    }
    recordMoveDecision(move, choice);
    clearPendingMove();
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-warning-title"
      initial={reduced ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, background: "rgba(28,26,22,.45)", backdropFilter: "blur(4px)", display: "flex", alignItems: "flex-end", zIndex: 40 }}
    >
      <motion.div
        initial={reduced ? undefined : { y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 30 }}
        style={{ width: "100%", background: "var(--crema)", borderRadius: "24px 24px 0 0", padding: "12px 20px 32px", display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 -8px 32px rgba(28,26,22,0.18)" }}
      >
        <div style={{ width: 40, height: 4.5, borderRadius: 100, background: "var(--sabbia-bordo)", margin: "0 auto" }} />
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <p id="move-warning-title" style={{ font: "600 20px/1.2 var(--font-outfit)", margin: 0 }}>
              Attenzione a questo spostamento
            </p>
            <p style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>
              Spostata a {formatFullDate(move.to)}. Puoi tenerla così: decidi tu.
            </p>
          </div>
          <div style={{ flexShrink: 0 }}>
            <Illustration name="scarico" size={48} float />
          </div>
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {move.check.warnings.map((warning) => (
            <li key={warning.fingerprint} style={{ background: "var(--crema-card)", border: "var(--border-airbnb)", borderRadius: "var(--radius-card)", padding: 13 }}>
              <p style={{ fontSize: 14, lineHeight: 1.45, margin: 0 }}>{warning.message}</p>
              <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>
                {EVIDENCE_LABELS[warning.evidence]}
              </p>
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {adapted && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.96 }}
              whileHover={{ scale: 1.015, y: -1 }}
              transition={{ type: "spring", stiffness: 450, damping: 25 }}
              style={button(true)}
              onClick={() => answer("adatta")}
            >
              Adatta: {adapted.title}
            </motion.button>
          )}
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.015, y: -1 }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            style={button(!adapted)}
            onClick={() => answer("confermo")}
          >
            Confermo, mi prendo il rischio
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            whileHover={{ scale: 1.015, y: -1 }}
            transition={{ type: "spring", stiffness: 450, damping: 25 }}
            style={button(false)}
            onClick={() => answer("annulla")}
          >
            Annulla, rimettila a {formatFullDate(move.from)}
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function button(primary: boolean): React.CSSProperties {
  return {
    width: "100%",
    background: primary ? "var(--inchiostro)" : "var(--sabbia-chip)",
    color: primary ? "var(--crema)" : "var(--inchiostro)",
    border: "none",
    borderRadius: "var(--radius-pill)",
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    textAlign: "center",
  };
}
