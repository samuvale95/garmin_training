"use client";

import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, Skeleton } from "@/components/motion/primitives";
import { useRequirePlan } from "@/lib/guards";
import { usePlanDiff, useStartSync } from "@/lib/queries";
import { useSyncFlowStore } from "@/lib/syncFlowStore";
import { capitalize, formatShortDate, numberToItalianWords, planStepsSummary } from "@/lib/format";
import type { TrainingSession } from "@/lib/types";

export default function DiffPage() {
  const router = useRouter();
  const plan = useRequirePlan();
  const diffQuery = usePlanDiff(plan?.sessions ?? null);
  const startSync = useStartSync();
  const setSelection = useSyncFlowStore((s) => s.setSelection);
  const markStarted = useSyncFlowStore((s) => s.markStarted);

  if (!plan) return null;

  const diff = diffQuery.data;

  async function writeNewOnly() {
    if (!diff) return;
    setSelection(diff.to_create, []);
    markStarted();
    const { job_id } = await startSync.mutateAsync({ to_create: diff.to_create, changed: [] });
    router.push(`/sync?job=${job_id}`);
  }

  function reviewChanged() {
    if (!diff) return;
    setSelection([], diff.changed);
    router.push("/confirm-deletions");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ padding: "24px 22px 16px", background: "var(--crema)", position: "sticky", top: 0, zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PageHeader backHref="/import" />
            <BrandMark height={22} forceStatic stillZone />
          </div>
          <span style={{ fontSize: 11, color: "var(--inchiostro-35)", fontWeight: 500 }}>fermo · stai decidendo</span>
        </div>
        <h1 style={{ font: "600 30px/1.04 var(--font-outfit)", letterSpacing: "-.035em", margin: "16px 0 6px" }}>
          {diff ? `${capitalize(numberToItalianWords(diff.to_create.length + diff.changed.length))} differenze` : "Differenze"}
        </h1>
        <p className="font-serif-italic" style={{ fontSize: 15.5, color: "var(--inchiostro-70)", margin: "0 0 14px" }}>
          Il file e il calendario non dicono la stessa cosa. Scegli tu cosa vince.
        </p>
        {diff && (
          <div style={{ display: "flex", gap: 8 }}>
            <Chip label={`${diff.to_create.length} nuove`} bg="var(--verde)" fg="var(--verde-testo)" />
            <Chip label={`${diff.changed.length} cambiate`} bg="var(--giallo)" fg="var(--giallo-testo)" />
            <Chip label={`${diff.already_present.length - diff.changed.length} uguali`} bg="var(--sabbia)" fg="var(--inchiostro-70)" />
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 22px", display: "flex", flexDirection: "column", gap: 10 }}>
        {!diff &&
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={64} radius={18} />)}

        {diff?.to_create.map((session, i) => (
          <SessionCard key={`new-${i}`} kind="new" session={session} />
        ))}
        {diff?.changed.map((change, i) => (
          <ChangedCard key={`changed-${i}`} session={change.session} previousTitle={change.workout.title} />
        ))}
        {diff?.already_present
          .filter((s) => !diff.changed.some((c) => c.session.date === s.date && c.session.title === s.title))
          .map((session, i) => (
            <SessionCard key={`same-${i}`} kind="same" session={session} />
          ))}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          padding: "24px 22px",
          background: "linear-gradient(to top, var(--crema) 62%, transparent)",
        }}
      >
        <PrimaryButton
          state={!diff || diff.to_create.length === 0 ? "disabled" : startSync.isPending ? "loading" : "idle"}
          onClick={writeNewOnly}
        >
          {diff ? `Scrivi le ${diff.to_create.length} nuove` : "Calcolo..."}
        </PrimaryButton>
        {diff && diff.changed.length > 0 && (
          <button
            type="button"
            onClick={reviewChanged}
            className="tap-target"
            style={{ display: "block", width: "100%", textAlign: "center", background: "none", border: "none", color: "var(--inchiostro-50)", fontSize: 13, fontWeight: 600, marginTop: 12, cursor: "pointer" }}
          >
            Poi parliamo delle {numberToItalianWords(diff.changed.length)} cambiate
          </button>
        )}
      </div>
    </div>
  );
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ background: bg, color: fg, borderRadius: "var(--radius-pill)", padding: "6px 12px", fontSize: 12, fontWeight: 600 }}>
      {label}
    </span>
  );
}

function SessionCard({ kind, session }: { kind: "new" | "same"; session: TrainingSession }) {
  const borderColor = kind === "new" ? "var(--verde-tratto)" : "var(--sabbia-bordo)";
  const summary = planStepsSummary(session.steps ?? []);
  return (
    <div
      style={{
        background: "var(--crema-card)",
        borderRadius: "var(--radius-row)",
        borderLeft: `4px solid ${borderColor}`,
        padding: 14,
        opacity: kind === "same" ? 0.55 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{session.title}</p>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>{formatShortDate(session.date)}</span>
      </div>
      {summary && (
        <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "4px 0 0" }}>{summary}</p>
      )}
      {kind === "new" && (
        <p style={{ fontSize: 11, color: "var(--verde-tratto-scuro)", margin: "6px 0 0" }}>nuova · la creo</p>
      )}
    </div>
  );
}

function ChangedCard({ session, previousTitle }: { session: TrainingSession; previousTitle: string }) {
  const summary = planStepsSummary(session.steps ?? []);
  return (
    <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-row)", borderLeft: "4px solid var(--giallo)", padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>{session.title}</p>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>{formatShortDate(session.date)}</span>
      </div>
      <p className="font-mono" style={{ fontSize: 13, color: "var(--rosso-avviso)", textDecoration: "line-through", margin: "0 0 2px" }}>
        era {previousTitle}
      </p>
      <p className="font-mono" style={{ fontSize: 13, color: "var(--verde-tratto-scuro)", margin: 0 }}>
        ora {session.title}{summary ? ` · ${summary}` : ""}
      </p>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "6px 0 0" }}>cambiata · cancello e ricreo</p>
    </div>
  );
}
