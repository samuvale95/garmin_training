"use client";

import { useParams } from "next/navigation";
import { StravaComparisonScreen } from "@/components/StravaComparisonScreen";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { findPlanSession, useStravaActivityMatch, useStravaStatus } from "@/lib/queries";

export default function SessionStravaPage() {
  const params = useParams<{ id: string }>();
  const { plan } = useRequirePlan();
  const animate = useMountOnce(`session-strava-${params.id}`);
  const session = findPlanSession(plan, params.id);

  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);

  return (
    <StravaComparisonScreen
      backHref={`/session/${session?.id ?? params.id}`}
      date={session?.date ?? null}
      title={session?.title ?? null}
      match={matchQuery.data}
      // Still waiting on the plan itself counts as loading: the screen shows its shape
      // rather than nothing (it used to `return null` until both were available).
      isLoading={!session || matchQuery.isPending}
      stravaConnected={!!stravaStatus.data?.connected}
      shoesFrom={`/session/${session?.id ?? params.id}/strava`}
      backLabel="Torna alla sessione"
      animate={animate}
    />
  );
}
