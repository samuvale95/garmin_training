"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, ProgressRing, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { usePassoStore } from "@/lib/store";
import { useStravaActivityMatch, useStravaStatus } from "@/lib/queries";
import { sessionDistanceKm } from "@/lib/sessionVisuals";
import { formatWeekday, groupSteps, stepDistanceKm, stepGroupParts } from "@/lib/format";

export default function SessionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const plan = useRequirePlan();
  const animate = useMountOnce(`session-${params.id}`);
  const updateSession = usePassoStore((s) => s.updateSession);
  const index = Number(params.id);
  const session = plan?.sessions[index] ?? null;
  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);
  const hasStravaMatch = !!stravaStatus.data?.connected && !!matchQuery.data?.matched;

  if (!plan) return null;

  if (!session) {
    return (
      <div style={{ padding: 22 }}>
        <PageHeader backHref="/week" />
        <p>Sessione non trovata.</p>
      </div>
    );
  }

  const currentSession = session; // narrows the closures below to non-null, once
  const distanceKm = sessionDistanceKm(currentSession);
  const groups = groupSteps(currentSession.steps);

  function nextDayKey(): string {
    const current = new Date(currentSession.date);
    current.setDate(current.getDate() + 1);
    return current.toISOString().slice(0, 10);
  }

  function moveToTomorrow() {
    updateSession(index, (s) => ({ ...s, date: nextDayKey() }));
    router.push("/week");
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px 32px", display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <PageHeader backHref="/week" color="var(--crema)" />
        <Link href={`/session/${index}/edit`} className="tap-target" aria-label="Modifica allenamento" style={{ color: "var(--crema)", fontSize: 18, textDecoration: "none" }}>
          ✎
        </Link>
      </div>
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
        {groups.length === 0 && (
          <p style={{ textAlign: "center", color: "var(--inchiostro-su-scuro)", fontSize: 13 }}>Sessione libera, senza step strutturati.</p>
        )}
        {groups.map((group, i) => {
          const isKey = group.kind === "interval";
          const { label, detail } = stepGroupParts(group);
          const km = group.reps * stepDistanceKm(group.step) + (group.recovery ? group.reps * stepDistanceKm(group.recovery) : 0);
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
                gap: 10,
              }}
              className={isKey ? "anim-breath" : undefined}
            >
              <span>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>{label}</span>
                {detail && (
                  <span className="font-mono" style={{ display: "block", fontSize: 11, opacity: 0.8, marginTop: 2 }}>{detail}</span>
                )}
              </span>
              {km > 0 && (
                <span className="font-mono" style={{ fontSize: 12, flex: "none" }}>{km.toFixed(1).replace(".", ",")} km</span>
              )}
            </div>
          );
        })}
      </div>

      {hasStravaMatch && (
        <Link href={`/session/${index}/strava`} style={{ textDecoration: "none", color: "inherit", width: "100%" }}>
          <div style={{ width: "100%", boxSizing: "border-box", background: "rgba(246,238,218,.09)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 20, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Svolta ieri, da Strava</p>
              <p className="font-serif-italic" style={{ fontSize: 12.5, color: "var(--inchiostro-su-scuro)", margin: "3px 0 0" }}>
                Confronta pianificato e svolto
              </p>
            </div>
            <span aria-hidden="true">›</span>
          </div>
        </Link>
      )}

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
          Sposta a {formatWeekday(nextDayKey())}
        </button>
      </div>
    </div>
  );
}
