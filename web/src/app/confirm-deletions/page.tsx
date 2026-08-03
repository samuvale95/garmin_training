"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { PrimaryButton } from "@/components/motion/primitives";
import { useStartSync } from "@/lib/queries";
import { useSyncFlowStore } from "@/lib/syncFlowStore";

export default function ConfirmDeletionsPage() {
  const router = useRouter();
  const changed = useSyncFlowStore((s) => s.changed);
  const startSync = useStartSync();

  async function confirmRewrite() {
    const { job_id } = await startSync.mutateAsync({
      to_create: [],
      changed: changed.map((c) => ({
        session: c.session,
        scheduled_workout_id: c.workout.scheduled_workout_id,
        workout_id: c.workout.workout_id,
        workout_date: c.workout.date,
        workout_sport: c.workout.sport,
        workout_title: c.workout.title,
      })),
    });
    router.push(`/sync?job=${job_id}`);
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--rosa-avviso)", padding: "24px 22px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <BrandMark height={22} color="var(--rosso-forte)" forceStatic stillZone />
        <span style={{ fontSize: 11, color: "var(--rosa-testo-50)", fontWeight: 500 }}>fermo · azione irreversibile</span>
      </div>

      <h1 style={{ font: "600 28px/1.1 var(--font-outfit)", color: "var(--rosso-testo)", letterSpacing: "-.03em", margin: "20px 0 8px" }}>
        Per cambiarle,
        <br />
        devo cancellarle
      </h1>

      {changed.length === 0 ? (
        <p style={{ color: "var(--rosso-testo)", fontSize: 14 }}>Nessuna sessione da confermare.</p>
      ) : (
        <>
          <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 8, display: "flex", flexDirection: "column", gap: 10 }}>
            {changed.map((change, i) => (
              <div key={i} style={{ borderBottom: i < changed.length - 1 ? "1px solid var(--sabbia-bordo)" : "none", paddingBottom: 10 }}>
                <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "0 0 2px" }}>{change.session.date}</p>
                <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{change.session.title}</p>
                <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>mai eseguita</p>
              </div>
            ))}
          </div>

          <div style={{ background: "var(--corallo-chiaro)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 12 }}>
            <p style={{ fontSize: 13, color: "var(--corallo-testo)", margin: 0, lineHeight: 1.5 }}>
              Nessuna di queste è mai stata svolta, quindi non perdi nulla. Le attività già registrate non vengono mai toccate.
            </p>
          </div>

          <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--rosso-testo)", marginTop: 16 }}>
            Garmin non sa modificare un allenamento: per cambiarlo devo cancellarlo e ricrearlo. Se qualcosa va storto a metà, resti senza.
          </p>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16 }}>
            <PrimaryButton
              state={startSync.isPending ? "loading" : "idle"}
              onClick={confirmRewrite}
              background="var(--rosso-forte)"
              textColor="var(--crema)"
              fillColor="var(--rosso-forte)"
            >
              Cancella e ricrea le {changed.length}
            </PrimaryButton>
            <button
              type="button"
              onClick={() => router.push("/diff")}
              className="tap-target"
              style={{ background: "var(--crema-card)", border: "none", borderRadius: "var(--radius-pill)", padding: "14px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
            >
              Annulla
            </button>
          </div>
        </>
      )}
    </div>
  );
}
