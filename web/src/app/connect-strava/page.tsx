"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useStravaAuthorize } from "@/lib/queries";
import { ApiError } from "@/lib/apiClient";

export default function ConnectStravaPage() {
  const router = useRouter();
  const animate = useMountOnce("connect-strava");
  const authorize = useStravaAuthorize();
  const [error, setError] = useState<string | null>(null);

  async function handleAuthorize() {
    setError(null);
    try {
      const { authorize_url } = await authorize.mutateAsync();
      window.location.href = authorize_url;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Non sono riuscito ad avviare l'autorizzazione Strava.");
    }
  }

  return (
    <div style={{ padding: "30px 22px 0", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <PageHeader backHref="/settings" />
        <Avatar size={30} />
      </div>

      <WordIn active={animate} style={{ font: "600 32px/1.05 var(--font-outfit)", letterSpacing: "-.035em", marginTop: 20 }}>
        Collega Strava
      </WordIn>

      <SlideUp active={animate} delayMs={120} className="font-serif-italic" style={{ fontSize: 16, color: "var(--inchiostro-70)", maxWidth: 300, marginTop: 8 }}>
        Garmin ti dice cosa fare. Strava ti dice cosa hai fatto davvero: passo, battito, dislivello, sensazione.
      </SlideUp>

      <SlideUp
        active={animate}
        delayMs={220}
        style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 22, display: "flex", flexDirection: "column", gap: 14 }}
      >
        <InfoRow title="Colma le lacune del piano">
          Ogni sessione svolta viene affiancata a quella pianificata: passo reale, frequenza cardiaca, dislivello, sensazione percepita — così vedi dove il piano ha retto e dove no.
        </InfoRow>
        <div style={{ height: 1, background: "var(--sabbia-bordo)" }} />
        <InfoRow title="Sola lettura">
          Non scrivo niente su Strava. Leggo solo le attività per confrontarle col piano.
        </InfoRow>
      </SlideUp>

      {error && (
        <p style={{ color: "var(--rosso-forte)", fontSize: 13, marginTop: 16 }} role="alert">
          {error}
        </p>
      )}

      <div style={{ flex: 1 }} />

      <SlideUp active={animate} delayMs={340} style={{ paddingBottom: 24, display: "flex", flexDirection: "column", gap: 12 }}>
        <PrimaryButton state={authorize.isPending ? "loading" : "idle"} onClick={handleAuthorize}>
          Autorizza Strava
        </PrimaryButton>
        <button
          type="button"
          onClick={() => router.push("/settings")}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-50)", fontSize: 13, cursor: "pointer" }}
        >
          Non ora
        </button>
      </SlideUp>
    </div>
  );
}

function InfoRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 4px" }}>{title}</p>
      <p style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.5 }}>{children}</p>
    </div>
  );
}
