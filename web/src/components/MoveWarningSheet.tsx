"use client";

import { useMotionEnabled } from "@/lib/motion";
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="move-warning-title"
      style={{ position: "fixed", inset: 0, background: "rgba(28,26,22,.4)", display: "flex", alignItems: "flex-end", zIndex: 40 }}
    >
      <div
        className={reduced ? undefined : "anim-slide-up"}
        style={{ width: "100%", background: "var(--crema)", borderRadius: "22px 22px 0 0", padding: "10px 20px 28px", display: "flex", flexDirection: "column", gap: 14 }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 100, background: "var(--sabbia-bordo)", margin: "0 auto" }} />
        <div>
          <p id="move-warning-title" style={{ font: "600 19px/1.2 var(--font-outfit)", margin: 0 }}>
            Attenzione a questo spostamento
          </p>
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>
            Spostata a {formatFullDate(move.to)}. Puoi tenerla così: decidi tu.
          </p>
        </div>

        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {move.check.warnings.map((warning) => (
            <li key={warning.fingerprint} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 12 }}>
              <p style={{ fontSize: 14, lineHeight: 1.45, margin: 0 }}>{warning.message}</p>
              <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>
                {EVIDENCE_LABELS[warning.evidence]}
              </p>
            </li>
          ))}
        </ul>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {adapted && (
            <button type="button" className="press-soft" style={button(true)} onClick={() => answer("adatta")}>
              Adatta: {adapted.title}
            </button>
          )}
          <button type="button" className="press-soft" style={button(!adapted)} onClick={() => answer("confermo")}>
            Confermo, mi prendo il rischio
          </button>
          <button type="button" className="press-soft" style={button(false)} onClick={() => answer("annulla")}>
            Annulla, rimettila a {formatFullDate(move.from)}
          </button>
        </div>
      </div>
    </div>
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
