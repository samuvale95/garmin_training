"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PrimaryButton } from "@/components/motion/primitives";
import { useConnectStrava } from "@/lib/queries";
import { ApiError } from "@/lib/apiClient";

/** Strava redirects here with `?code=...` (or `?error=access_denied` if the user
 * declined) after the consent screen at STRAVA_REDIRECT_URI. This completes the
 * code exchange server-side, then returns to Settings -- the same "land back where
 * you started, updated" shape screen 16's spec describes. */
export default function StravaCallbackPage() {
  return (
    <Suspense fallback={<CallbackFallback />}>
      <StravaCallback />
    </Suspense>
  );
}

function CallbackFallback() {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 22 }}>
      <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)" }}>Collegamento a Strava...</p>
    </div>
  );
}

function StravaCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const connect = useConnectStrava();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const code = searchParams.get("code");
    const deniedOrFailed = searchParams.get("error");
    if (deniedOrFailed || !code) {
      router.replace("/settings");
      return;
    }

    connect
      .mutateAsync(code)
      .then(() => router.replace("/settings"))
      .catch((err) => setError(err instanceof ApiError ? err.message : "Non sono riuscito a completare il collegamento con Strava."));
  }, [searchParams, connect, router]);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 22, gap: 14 }}>
      {error ? (
        <>
          <p style={{ color: "var(--rosso-forte)", fontSize: 14, textAlign: "center" }} role="alert">
            {error}
          </p>
          <div style={{ width: 200 }}>
            <PrimaryButton onClick={() => router.replace("/settings")}>Torna alle impostazioni</PrimaryButton>
          </div>
        </>
      ) : (
        <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)" }}>Collegamento a Strava...</p>
      )}
    </div>
  );
}
