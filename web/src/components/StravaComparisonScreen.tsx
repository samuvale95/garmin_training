"use client";

import Link from "next/link";
import { WordIn } from "@/components/motion/primitives";
import { DetailScaffold } from "@/components/DetailScaffold";
import { SkeletonStravaPanel } from "@/components/skeletons";
import { StravaMatchPanel } from "@/components/StravaMatchPanel";
import { formatFullDate } from "@/lib/format";
import type { StravaActivityMatch } from "@/lib/types";

/** The planned-vs-done comparison screen.
 *
 * `session/[id]/strava` (an imported plan's session) and `workout/[id]/strava` (a live
 * Garmin-calendar workout) were line-for-line copies of this apart from how they obtain
 * the session, so it lives here once. */
export function StravaComparisonScreen({
  backHref,
  date,
  title,
  match,
  isLoading,
  stravaConnected,
  shoesFrom,
  backLabel,
  animate,
}: {
  backHref: string;
  date: string | null;
  title: string | null;
  match: StravaActivityMatch | undefined;
  isLoading: boolean;
  /** Distinguishes "Strava isn't connected" from "nothing matched this date" -- these
   * screens used to report the second for both, which is simply wrong advice. */
  stravaConnected: boolean;
  shoesFrom: string;
  backLabel: string;
  animate: boolean;
}) {
  return (
    <DetailScaffold backHref={backHref} caption={date ? `${formatFullDate(date)} · da Strava` : undefined}>
      <div style={{ alignSelf: "stretch" }}>
        {title && (
          <WordIn active={animate} style={{ font: "600 26px/1.1 var(--font-outfit)", marginTop: 16 }}>
            {title}
          </WordIn>
        )}

        {!stravaConnected ? (
          <div style={{ marginTop: 20 }}>
            <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-su-scuro)", margin: 0 }}>
              Strava non è collegato, quindi non posso confrontare il pianificato con lo svolto.
            </p>
            <Link
              href="/connect-strava"
              className="tap-target"
              style={{ display: "inline-block", marginTop: 14, color: "var(--corallo)", fontSize: 14, fontWeight: 600 }}
            >
              Collega Strava →
            </Link>
          </div>
        ) : isLoading && !match ? (
          <SkeletonStravaPanel />
        ) : (
          <StravaMatchPanel match={match} isLoading={isLoading} shoesFrom={shoesFrom} />
        )}

        <div style={{ marginTop: 28, textAlign: "center" }}>
          <Link
            href={backHref}
            className="tap-target"
            style={{ color: "var(--crema)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            {backLabel}
          </Link>
        </div>
      </div>
    </DetailScaffold>
  );
}
