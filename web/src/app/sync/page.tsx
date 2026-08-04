"use client";

import { Suspense, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { PageHeader } from "@/components/PageHeader";
import { StatusDot, WordIn, BarGrow } from "@/components/motion/primitives";
import { useCancelSync, useSyncJobStatus } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { useSyncFlowStore } from "@/lib/syncFlowStore";

function SyncScreenInner() {
  const router = useRouter();
  const jobId = useSearchParams().get("job");
  const { data: status } = useSyncJobStatus(jobId);
  const cancelSync = useCancelSync();
  const addJobHistory = usePassoStore((s) => s.addJobHistory);
  const startedAt = useSyncFlowStore((s) => s.startedAt);
  const navigatedRef = useRef(false);

  useEffect(() => {
    if (!status || navigatedRef.current) return;
    if (status.status === "running") return;

    navigatedRef.current = true;
    addJobHistory({
      jobId: status.job_id,
      finishedAt: new Date().toISOString(),
      total: status.total,
      succeeded: status.items.filter((i) => i.status === "ok").length,
      failed: status.items.filter((i) => i.status === "failed").length,
      items: status.items,
      durationMs: startedAt != null ? Date.now() - startedAt : null,
    });
    router.push(`/sync/result?job=${status.job_id}`);
  }, [status, addJobHistory, startedAt, router]);

  if (!jobId) {
    return (
      <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: 22 }}>
        <PageHeader color="var(--crema)" />
        <p style={{ marginTop: 14 }}>Nessuna scrittura in corso.</p>
      </div>
    );
  }

  const total = status?.total ?? 0;
  const completed = status?.completed ?? 0;
  const done = status?.items.filter((i) => i.status === "ok").length ?? 0;
  const failed = status?.items.filter((i) => i.status === "failed").length ?? 0;
  const queued = total - completed;
  const progress = total > 0 ? completed / total : 0;
  const lastThree = status?.items.slice(Math.max(0, completed - 3), completed + 1).slice(-3) ?? [];

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader color="var(--crema)" />
          <BrandMark height={26} color="var(--crema)" />
        </div>
        <span style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", fontWeight: 500 }}>scrivo su Garmin</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 24 }}>
        <WordIn style={{ font: "600 72px/1 var(--font-outfit)", letterSpacing: "-.05em" }}>{completed}</WordIn>
        <span style={{ fontSize: 16, color: "var(--inchiostro-su-scuro)" }}>di {total} sessioni</span>
      </div>

      <div style={{ marginTop: 16 }}>
        <BarGrow value={progress} height={8} trackColor="rgba(246,238,218,.14)" />
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 18 }}>
        <Count value={done} label="fatte" color="var(--verde-tratto)" />
        <Count value={failed} label="rifiutata" color="var(--corallo-chiaro)" />
        <Count value={queued} label="in coda" color="var(--inchiostro-su-scuro)" />
      </div>

      <div style={{ flex: 1, position: "relative", minHeight: 160, marginTop: 20, background: "rgba(246,238,218,.05)", borderRadius: "var(--radius-card-lg)", padding: 18, boxSizing: "border-box" }}>
        <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Puoi chiudere</p>
        <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-su-scuro)", maxWidth: 180, margin: 0 }}>
          Continuo io. Ti trovo il riepilogo quando torni.
        </p>
        <Illustration name="attesa" width={190} height={206} right={14} bottom={0} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 16 }}>
        {lastThree.map((item, i) => {
          const statusLabel = item.status === "ok" ? "ok" : item.status === "failed" ? item.error ?? "errore" : "invio";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <StatusDot kind={item.status === "ok" ? "success" : item.status === "failed" ? "error" : "in_progress"} />
              <span style={{ fontSize: 13, flex: 1 }}>{item.title}</span>
              <span className="font-mono" style={{ fontSize: 11, color: item.status === "failed" ? "var(--corallo-chiaro)" : "var(--inchiostro-su-scuro)" }}>{statusLabel}</span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => jobId && cancelSync.mutate(jobId)}
        disabled={cancelSync.isPending || status?.cancel_requested}
        className="tap-target"
        style={{ background: "none", border: "none", color: "var(--inchiostro-su-scuro)", fontSize: 12, marginTop: 16, cursor: "pointer" }}
      >
        {status?.cancel_requested ? "Mi fermo dopo questa sessione…" : "Interrompi dopo questa"}
      </button>
    </div>
  );
}

function Count({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <p style={{ font: "600 20px/1 var(--font-outfit)", color, margin: "0 0 2px" }}>{value}</p>
      <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: 0 }}>{label}</p>
    </div>
  );
}

export default function SyncPage() {
  return (
    <Suspense fallback={null}>
      <SyncScreenInner />
    </Suspense>
  );
}
