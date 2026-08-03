"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { useMountOnce } from "@/lib/motion";
import { useBodyConflict, useBodyToday } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { toDateKey } from "@/lib/sessionVisuals";
import type { ConflictOption } from "@/lib/types";

export default function ConflictPage() {
  const router = useRouter();
  const animate = useMountOnce("body-conflict");
  const plan = usePassoStore((s) => s.plan);
  const updateSession = usePassoStore((s) => s.updateSession);
  const bodyQuery = useBodyToday();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);
  const sessionIndex = plan?.sessions.findIndex((s) => s.date === tomorrowKey) ?? -1;
  const nextSession = sessionIndex >= 0 ? plan!.sessions[sessionIndex] : null;

  const conflictQuery = useBodyConflict(nextSession);

  function applyOption(option: ConflictOption) {
    if (sessionIndex < 0) return;
    if (option.kind === "reschedule") {
      updateSession(sessionIndex, (s) => {
        const d = new Date(s.date);
        d.setDate(d.getDate() + 1);
        return { ...s, date: toDateKey(d) };
      });
    } else if (option.kind === "soften") {
      updateSession(sessionIndex, (s) => {
        const intervalIndexes = s.steps.map((step, i) => (step.type === "interval" ? i : -1)).filter((i) => i >= 0);
        if (intervalIndexes.length <= 1) return s;
        const lastInterval = intervalIndexes[intervalIndexes.length - 1];
        return { ...s, steps: s.steps.filter((_, i) => i !== lastInterval) };
      });
    }
    router.push("/today");
  }

  if (!nextSession || !conflictQuery.data?.has_conflict) {
    return (
      <div style={{ padding: "24px 22px" }}>
        <BrandMark height={22} />
        <p style={{ marginTop: 20 }}>Nessun conflitto tra il corpo e il piano di domani.</p>
      </div>
    );
  }

  const { signals, options } = conflictQuery.data;

  return (
    <div style={{ padding: "24px 22px 32px" }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--rosa-avviso)", color: "var(--rosso-testo)", borderRadius: "var(--radius-pill)", padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--rosso-avviso)" }} className={animate ? "anim-dot-pulse" : undefined} />
        stamattina qualcosa non torna
      </span>

      <h1 style={{ font: "600 28px/1.1 var(--font-outfit)", letterSpacing: "-.03em", margin: "16px 0 8px" }}>
        Il corpo dice no
      </h1>
      <p className="font-serif-italic" style={{ fontSize: 15.5, color: "var(--inchiostro-70)" }}>
        {signals.join(", ")}: {bodyQuery.data?.readiness_message ?? "i segnali di stamattina non sono dalla tua parte"}.
      </p>

      <div style={{ background: "var(--corallo)", color: "var(--corallo-testo)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 16, height: 152, position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
        <p style={{ fontSize: 12, margin: "0 0 4px", opacity: 0.8 }}>domani</p>
        <p style={{ fontSize: 18, fontWeight: 600, margin: 0, maxWidth: 180 }}>{nextSession.title}</p>
        <Illustration name="crollo" width={110} height={120} right={4} bottom={0} active={animate} delayMs={200} />
      </div>

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 14, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontWeight: 600, margin: 0 }}>Decidi tu. Io eseguo.</p>
        {options.map((option, i) => (
          <button
            key={i}
            type="button"
            onClick={() => applyOption(option)}
            className="tap-target"
            style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--sabbia)", border: "none", borderRadius: "var(--radius-row)", padding: 14, textAlign: "left", cursor: "pointer" }}
          >
            <span style={{ width: 34, height: 34, borderRadius: "50%", background: "var(--inchiostro)", color: "var(--crema)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
              →
            </span>
            <span>
              <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>{option.label}</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--inchiostro-50)" }}>{option.detail}</span>
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => router.push("/today")}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-35)", fontSize: 12, cursor: "pointer" }}
        >
          Lascia tutto com&apos;è
        </button>
      </div>

      <p className="font-serif-italic" style={{ fontSize: 15, textAlign: "center", color: "var(--inchiostro-70)", marginTop: 18 }}>
        Qualunque cosa scegli, te la riscrivo nel file.
      </p>
    </div>
  );
}
