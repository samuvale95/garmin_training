"use client";

import { useParams, useRouter } from "next/navigation";
import { PrimaryButton, ProgressRing, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { usePassoStore } from "@/lib/store";
import { sessionDistanceKm } from "@/lib/sessionVisuals";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const plan = useRequirePlan();
  const animate = useMountOnce(`session-${params.id}`);
  const updateSession = usePassoStore((s) => s.updateSession);

  if (!plan) return null;

  const index = Number(params.id);
  const session = plan.sessions[index];
  if (!session) {
    return (
      <div style={{ padding: 22 }}>
        <p>Sessione non trovata.</p>
        <button onClick={() => router.back()}>Indietro</button>
      </div>
    );
  }

  const distanceKm = sessionDistanceKm(session);
  const keyStepIndex = session.steps.findIndex((s) => s.type === "interval");

  function moveToTomorrow() {
    const current = new Date(session.date);
    current.setDate(current.getDate() + 1);
    updateSession(index, (s) => ({ ...s, date: current.toISOString().slice(0, 10) }));
    router.push("/week");
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <ProgressRing value={Math.min(1, distanceKm / 20)} size={180} strokeWidth={12} trackColor="rgba(246,238,218,.13)">
        <div style={{ textAlign: "center" }}>
          <p className="font-mono" style={{ fontSize: 28, fontWeight: 500, margin: 0 }}>{distanceKm.toFixed(1)}</p>
          <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: 0 }}>km totali</p>
        </div>
      </ProgressRing>

      <WordIn active={animate} delayMs={200} style={{ font: "600 26px/1.06 var(--font-outfit)", textAlign: "center", marginTop: 20 }}>
        {session.title}
      </WordIn>
      {session.description && (
        <p className="font-serif-italic" style={{ fontSize: 15.5, textAlign: "center", color: "var(--inchiostro-su-scuro)", maxWidth: 280 }}>
          {session.description}
        </p>
      )}

      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 20 }}>
        {session.steps.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--inchiostro-su-scuro)", fontSize: 13 }}>Sessione libera, senza step strutturati.</p>
        )}
        {session.steps.map((step, i) => {
          const isKey = i === keyStepIndex;
          return (
            <div
              key={i}
              style={{
                background: isKey ? "var(--corallo)" : "rgba(246,238,218,.07)",
                color: isKey ? "var(--corallo-testo)" : "var(--crema)",
                borderRadius: "var(--radius-row)",
                padding: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
              className={isKey ? "anim-breath" : undefined}
            >
              <span style={{ fontSize: 13, fontWeight: 600, textTransform: "capitalize" }}>{step.type}</span>
              <span className="font-mono" style={{ fontSize: 12 }}>
                {step.duration_type === "time" ? `${step.duration_value} min` : `${step.duration_value} km`}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{ width: "100%", marginTop: 24, display: "flex", flexDirection: "column", gap: 10 }}>
        <PrimaryButton background="var(--verde)" textColor="var(--verde-testo)" fillColor="var(--verde)" successColor="var(--verde)">
          Già sul calendario
        </PrimaryButton>
        <button
          type="button"
          onClick={moveToTomorrow}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-su-scuro)", fontSize: 13, cursor: "pointer" }}
        >
          Sposta a domani
        </button>
      </div>
    </div>
  );
}
