"use client";

import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { WordIn } from "@/components/motion/primitives";
import { StravaMatchPanel } from "@/components/StravaMatchPanel";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { useStravaActivityMatch, useStravaStatus } from "@/lib/queries";
import { formatFullDate } from "@/lib/format";

export default function SessionStravaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const plan = useRequirePlan();
  const animate = useMountOnce(`session-strava-${params.id}`);
  const index = Number(params.id);
  const session = plan?.sessions[index] ?? null;

  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);

  if (!plan || !session) return null;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "24px 22px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref={`/session/${index}`} color="var(--crema)" />
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>
          {formatFullDate(session.date)} · da Strava
        </span>
      </div>

      <WordIn active={animate} style={{ font: "600 26px/1.1 var(--font-outfit)", marginTop: 16 }}>
        {session.title}
      </WordIn>

      <StravaMatchPanel
        match={matchQuery.data}
        isLoading={matchQuery.isLoading}
        showPlanned
        shoesFrom={`/session/${index}/strava`}
      />

      <div style={{ marginTop: 28, textAlign: "center" }}>
        <button
          type="button"
          onClick={() => router.push(`/session/${index}`)}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--crema)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
        >
          Torna alla sessione
        </button>
      </div>
    </div>
  );
}
