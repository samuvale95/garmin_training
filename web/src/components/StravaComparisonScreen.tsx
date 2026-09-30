"use client";

import Link from "next/link";
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
      <div style={{ width: "100%", marginTop: 12 }}>
        {title && (
          <h1
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--inchiostro)",
              margin: "12px 0 16px",
              letterSpacing: "-0.02em",
            }}
          >
            {title}
          </h1>
        )}

        {!stravaConnected ? (
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.5 }}>
              Strava non è collegato, quindi non posso confrontare il pianificato con lo svolto.
            </p>
            <Link
              href="/connect-strava"
              className="tap-target"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginTop: 14,
                color: "var(--corallo)",
                fontSize: 14,
                fontWeight: 600,
                textDecoration: "none",
              }}
            >
              Collega Strava →
            </Link>
          </div>
        ) : isLoading && !match ? (
          <SkeletonStravaPanel />
        ) : (
          <StravaMatchPanel match={match} isLoading={isLoading} shoesFrom={shoesFrom} />
        )}

        <div style={{ marginTop: 32, textAlign: "center" }}>
          <Link
            href={backHref}
            className="tap-target"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "var(--sabbia-chip)",
              border: "1px solid var(--border-airbnb)",
              borderRadius: "var(--radius-pill)",
              padding: "10px 20px",
              color: "var(--inchiostro)",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
              transition: "all 0.15s ease",
            }}
          >
            {backLabel}
          </Link>
        </div>
      </div>
    </DetailScaffold>
  );
}
