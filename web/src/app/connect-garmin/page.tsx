"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, WordIn, SlideUp } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useConnectGarmin } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { ApiError } from "@/lib/apiClient";

export default function ConnectGarminPage() {
  const router = useRouter();
  const animate = useMountOnce("connect-garmin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const connect = useConnectGarmin();
  const profile = usePassoStore((s) => s.profile);

  const setLastGarminEmail = usePassoStore((s) => s.setLastGarminEmail);

  async function handleConnect() {
    setError(null);
    setLastGarminEmail(email);
    try {
      await connect.mutateAsync({ email, password });
      router.push("/import");
    } catch (err) {
      if (err instanceof ApiError && err.category === "rate_limited") {
        router.push("/rate-limit");
        return;
      }
      setError(err instanceof ApiError ? err.message : "Qualcosa non ha funzionato. Riprova.");
    }
  }

  return (
    <div style={{ padding: "30px 22px 0", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader />
          <BrandMark height={24} />
        </div>
        {profile.email && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Avatar size={30} />
            <span style={{ fontSize: 13, color: "var(--inchiostro-70)" }}>{profile.email}</span>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24 }}>
        <WordIn active={animate} delayMs={0} style={{ font: "600 34px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>
          Un passo
        </WordIn>
        <WordIn active={animate} delayMs={100} style={{ font: "600 34px/1.04 var(--font-outfit)", letterSpacing: "-.035em" }}>
          e non ci pensi più
        </WordIn>
      </div>

      <SlideUp active={animate} delayMs={200} className="font-serif-italic" style={{ fontSize: 17, color: "var(--inchiostro-70)", maxWidth: 290, marginTop: 12 }}>
        La sessione Garmin resta attiva per settimane: questa schermata la vedi una volta.
      </SlideUp>

      <SlideUp
        active={animate}
        delayMs={300}
        style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 20, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <Field label="Email Garmin" value={email} onChange={setEmail} type="email" placeholder="luca@example.com" />
        <Field label="Password" value={password} onChange={setPassword} type="password" />
        <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>
          🔒 Resta sul telefono. Salvo solo il token, mai la password.
        </p>
      </SlideUp>

      <SlideUp active={animate} delayMs={400} style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <WarningCard title="Tre tentativi">poi Garmin blocca l&apos;IP per 15 minuti. Non insisto io al posto tuo.</WarningCard>
        <WarningCard title="Codice a 6 cifre">se hai la verifica in due passaggi, te lo chiedo dopo.</WarningCard>
      </SlideUp>

      {error && (
        <p style={{ color: "var(--rosso-forte)", fontSize: 13, marginTop: 16 }} role="alert">
          {error}
        </p>
      )}

      <div style={{ flex: 1 }} />

      <SlideUp active={animate} delayMs={500} style={{ paddingBottom: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        <PrimaryButton
          state={connect.isPending ? "loading" : "idle"}
          onClick={handleConnect}
        >
          Collega
        </PrimaryButton>
        <button
          type="button"
          onClick={() => router.push("/today")}
          className="tap-target"
          style={{ background: "none", border: "none", color: "var(--inchiostro-50)", fontSize: 13, cursor: "pointer" }}
        >
          Lo faccio dopo
        </button>
      </SlideUp>
    </div>
  );
}

function Field({ label, value, onChange, type, placeholder }: { label: string; value: string; onChange: (v: string) => void; type: string; placeholder?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 500, letterSpacing: ".1em", textTransform: "uppercase", color: "var(--inchiostro-50)", marginBottom: 8 }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: "100%",
          border: "none",
          borderBottom: `1.5px solid ${value ? "var(--inchiostro)" : "var(--sabbia-bordo)"}`,
          background: "transparent",
          fontFamily: "var(--font-dm-mono)",
          fontSize: 16,
          padding: "4px 0 9px",
          outline: "none",
        }}
      />
    </label>
  );
}

function WarningCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, background: "var(--sabbia)", borderRadius: "var(--radius-chip)", padding: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 600, margin: "0 0 4px" }}>{title}</p>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: 0, lineHeight: 1.4 }}>{children}</p>
    </div>
  );
}
