"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function SessionError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--inchiostro)",
        color: "var(--crema)",
        padding: "24px 22px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        textAlign: "center",
      }}
    >
      <p style={{ font: "600 20px/1.2 var(--font-outfit)", margin: 0 }}>Non riesco ad aprire questa sessione.</p>
      <p className="font-serif-italic" style={{ fontSize: 14, opacity: 0.75, margin: 0, maxWidth: 320 }}>
        {error.message || "Errore imprevisto."}
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button
          type="button"
          onClick={() => reset()}
          className="tap-target"
          style={{
            background: "var(--corallo)",
            color: "var(--corallo-testo)",
            border: "none",
            borderRadius: "var(--radius-row)",
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Riprova
        </button>
        <button
          type="button"
          onClick={() => router.push("/week")}
          className="tap-target"
          style={{
            background: "none",
            color: "var(--crema)",
            border: "1px solid rgba(246,238,218,.3)",
            borderRadius: "var(--radius-row)",
            padding: "10px 20px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Torna alla settimana
        </button>
      </div>
    </div>
  );
}
