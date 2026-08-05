"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useRequirePlan } from "@/lib/guards";
import { useStravaActivityMatch, useStravaStatus } from "@/lib/queries";
import { formatFullDate, formatPaceValue } from "@/lib/format";

export default function SessionStravaPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const plan = useRequirePlan();
  const animate = useMountOnce(`session-strava-${params.id}`);
  const index = Number(params.id);
  const session = plan?.sessions[index] ?? null;

  const stravaStatus = useStravaStatus();
  const matchQuery = useStravaActivityMatch(session, !!stravaStatus.data?.connected);
  const match = matchQuery.data;

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

      {!match || !match.matched ? (
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-su-scuro)", marginTop: 20 }}>
          {matchQuery.isLoading ? "Cerco l'attività su Strava..." : "Nessuna attività Strava corrispondente trovata per questa data."}
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <div style={{ flex: 1, background: "rgba(246,238,218,.08)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: "0 0 6px" }}>pianificato</p>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
                {match.planned_distance_km != null ? match.planned_distance_km.toFixed(1) : "—"} km
              </p>
              <p style={{ fontSize: 11, color: "var(--inchiostro-su-scuro)", margin: "4px 0 0" }}>
                {match.planned_pace_sec_per_km != null ? `${formatPaceValue(match.planned_pace_sec_per_km)} target` : "nessun passo target"}
              </p>
            </div>
            <div style={{ flex: 1, background: "var(--corallo)", color: "var(--corallo-testo)", borderRadius: "var(--radius-card)", padding: 14 }}>
              <p style={{ fontSize: 11, opacity: 0.75, margin: "0 0 6px" }}>svolto</p>
              <p className="font-mono" style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>
                {match.distance_km != null ? match.distance_km.toFixed(1) : "—"} km
              </p>
              <p style={{ fontSize: 11, margin: "4px 0 0" }}>
                {match.avg_pace_sec_per_km != null ? `${formatPaceValue(match.avg_pace_sec_per_km)} medio` : "—"}
              </p>
            </div>
          </div>

          <StravaRow label="Frequenza cardiaca">
            {match.average_heartrate != null ? `media ${Math.round(match.average_heartrate)} bpm` : "—"}
            {match.max_heartrate != null && ` · picco ${Math.round(match.max_heartrate)} bpm`}
          </StravaRow>

          <StravaRow label="Dislivello">
            {match.elevation_gain_m != null ? `+${Math.round(match.elevation_gain_m)} m` : "—"} · nessuno pianificato
          </StravaRow>

          {match.felt_note && (
            <StravaRow label="Sensazione">
              &quot;{match.felt_note}&quot; · nota da Strava
            </StravaRow>
          )}

          <Link href={`/shoes?from=${encodeURIComponent(`/session/${index}/strava`)}`} style={{ textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(246,238,218,.07)", borderRadius: "var(--radius-row)", padding: 14, marginTop: 10 }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>Scarpe</span>
                <span className="font-mono" style={{ display: "block", fontSize: 11.5, opacity: 0.8, marginTop: 2 }}>
                  {match.gear_name ?? "—"}
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </div>
          </Link>

          {match.plan_note && (
            <div style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 16 }}>
              <p style={{ fontWeight: 600, margin: "0 0 6px", fontSize: 14 }}>Cosa cambia nel piano</p>
              <p className="font-serif-italic" style={{ fontSize: 13.5, margin: 0 }}>{match.plan_note}</p>
            </div>
          )}
        </>
      )}

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

function StravaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "rgba(246,238,218,.07)", borderRadius: "var(--radius-row)", padding: 14, marginTop: 10 }}>
      <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 4px" }}>{label}</p>
      <p className="font-mono" style={{ fontSize: 12, opacity: 0.85, margin: 0 }}>{children}</p>
    </div>
  );
}
