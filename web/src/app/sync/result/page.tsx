"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Illustration } from "@/components/Illustration";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useStartSync, useSyncJobStatus } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { useSyncFlowStore } from "@/lib/syncFlowStore";
import { capitalize, formatDuration, formatShortDate, numberToItalianWords } from "@/lib/format";

function ResultScreenInner() {
  const router = useRouter();
  const jobId = useSearchParams().get("job");
  const animate = useMountOnce("sync-result");
  const { data: liveStatus } = useSyncJobStatus(jobId);
  const history = usePassoStore((s) => s.writeJobHistory);
  const flow = useSyncFlowStore();
  const startSync = useStartSync();

  const status = liveStatus ?? history.find((h) => h.jobId === jobId);
  if (!status) {
    return (
      <div style={{ padding: 22 }}>
        <PageHeader />
        <p style={{ marginTop: 14 }}>Nessun risultato da mostrare.</p>
      </div>
    );
  }

  const items = status.items;
  const total = status.total;
  const succeeded = items.filter((i) => i.status === "ok").length;
  const failed = items.filter((i) => i.status === "failed");
  const created = items.filter((i) => i.kind === "create" && i.status === "ok").length;
  const replaced = items.filter((i) => i.kind === "replace" && i.status === "ok").length;
  const durationMs = "durationMs" in status ? status.durationMs : null;

  async function retryFailed() {
    const failedKeys = new Set(failed.map((f) => `${f.date}|${f.title}`));
    const toCreate = flow.toCreate.filter((s) => failedKeys.has(`${s.date}|${s.title}`));
    const changed = flow.changed.filter((c) => failedKeys.has(`${c.session.date}|${c.session.title}`));
    flow.markStarted();
    const { job_id } = await startSync.mutateAsync({
      to_create: toCreate,
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
    <div style={{ padding: "24px 22px 32px" }}>
      <PageHeader />
      <div
        style={{
          marginTop: 14,
          background: "var(--verde)",
          color: "var(--verde-testo)",
          borderRadius: "var(--radius-card-lg)",
          padding: 20,
          height: 216,
          position: "relative",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
      >
        <p style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".08em", margin: 0 }}>scritte sul calendario</p>
        <WordIn active={animate} delayMs={300} style={{ font: "600 52px/1 var(--font-outfit)", letterSpacing: "-.045em", marginTop: 8 }}>
          {succeeded}
          <span style={{ fontSize: 24, opacity: 0.5 }}>/{total}</span>
        </WordIn>
        <p className="font-serif-italic" style={{ fontSize: 15, margin: "8px 0 0" }}>
          {failed.length === 0 ? "Il blocco è pronto." : "Quasi tutto pronto."}
        </p>
        <Illustration name="esultanza" width={172} height={186} right={8} bottom={0} active={animate} delayMs={700} />
      </div>

      {failed.length > 0 && (
        <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ fontWeight: 600, margin: 0 }}>
            {failed.length === 1 ? "Una è rimasta indietro" : `${capitalize(numberToItalianWords(failed.length))} sono rimaste indietro`}
          </p>
          {failed.map((item, i) => (
            <div key={i} style={{ borderLeft: "3px solid var(--corallo)", paddingLeft: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 2px" }}>{item.title}</p>
                <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>{formatShortDate(item.date)}</span>
              </div>
              <p style={{ fontSize: 12, color: "var(--inchiostro-70)", margin: 0 }}>{item.error ?? "Motivo non specificato."}</p>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 14 }}>
        {durationMs != null && <Metric label="durata" value={formatDuration(durationMs)} />}
        <Metric label="cancellate" value={replaced} />
        <Metric label="create" value={created} />
      </div>

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 10 }}>
        {failed.length > 0 && (
          <PrimaryButton state={startSync.isPending ? "loading" : "idle"} onClick={retryFailed}>
            Riprova solo queste {numberToItalianWords(failed.length)}
          </PrimaryButton>
        )}
        <button
          type="button"
          onClick={() => router.push("/week")}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-50)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Guarda la settimana
        </button>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div style={{ flex: 1, background: "var(--sabbia-chip)", borderRadius: "var(--radius-chip)", padding: "10px 12px" }}>
      <p className="font-mono" style={{ fontSize: 16, fontWeight: 500, margin: "0 0 2px" }}>{value}</p>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: 0 }}>{label}</p>
    </div>
  );
}

export default function SyncResultPage() {
  return (
    <Suspense fallback={null}>
      <ResultScreenInner />
    </Suspense>
  );
}
