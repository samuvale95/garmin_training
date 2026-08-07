"use client";

import { useState } from "react";
import { BrandMark } from "@/components/motion/BrandMark";
import { PrimaryButton } from "@/components/motion/primitives";
import { signInWithGoogle } from "@/lib/auth";

export default function LoginPage() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setPending(true);
    try {
      // Redirects the whole page to Google, then back here with a session -- there is
      // nothing to await locally on success, only the failure path (e.g. Supabase
      // misconfigured) returns before that redirect happens.
      await signInWithGoogle();
    } catch {
      setError("Accesso non riuscito. Riprova.");
      setPending(false);
    }
  }

  return (
    <div style={{ padding: "30px 22px 0", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <BrandMark height={26} />
        <span style={{ fontSize: 18, fontWeight: 600 }}>Passo</span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 16 }}>
        <p style={{ font: "600 28px/1.15 var(--font-outfit)", letterSpacing: "-.03em", margin: 0 }}>
          Accedi per continuare
        </p>
        <p className="font-serif-italic" style={{ fontSize: 16, color: "var(--inchiostro-70)", margin: 0, maxWidth: 280 }}>
          Un account Google identifica te su questo Passo -- Garmin e Strava li colleghi dopo, come sempre.
        </p>
      </div>

      <div style={{ paddingBottom: 28, display: "flex", flexDirection: "column", gap: 10 }}>
        {error && (
          <p style={{ fontSize: 13, color: "var(--rosso-forte)", margin: 0, textAlign: "center" }}>{error}</p>
        )}
        <PrimaryButton onClick={handleSignIn} state={pending ? "loading" : "idle"}>
          Continua con Google
        </PrimaryButton>
      </div>
    </div>
  );
}
