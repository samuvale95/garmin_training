"use client";

import { dis } from "@/lib/disabled";
import { useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/motion/BrandMark";
import { RunnerIcon, WatchIcon } from "@/components/Icons";
import { signInDev, signInWithGoogle } from "@/lib/auth";
import { useScreenReady } from "@/lib/useScreenReady";

export default function LoginPage() {
  useScreenReady(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setPending(true);
    try {
      await signInWithGoogle();
    } catch {
      setError("Accesso non riuscito. Riprova.");
      setPending(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "24px 20px 32px",
        background: "radial-gradient(ellipse at 50% 16%, rgba(255, 215, 220, 0.4) 0%, rgba(255, 255, 255, 0) 65%), var(--crema)",
        boxSizing: "border-box",
      }}
    >
      {/* Top Bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark height={26} />
          <span style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>Passo</span>
        </div>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 600,
            background: "var(--sabbia-chip)",
            color: "var(--inchiostro-70)",
            padding: "5px 12px",
            borderRadius: "var(--radius-pill)",
            letterSpacing: "0.02em",
          }}
        >
          Training
        </span>
      </div>

      {/* Main Center Card */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 350, damping: 28 }}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          margin: "auto 0",
          padding: "24px 12px",
        }}
      >
        {/* 3D Clay Hero Presentation */}
        <div
          style={{
            position: "relative",
            width: 140,
            height: 140,
            marginBottom: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 12,
              borderRadius: "50%",
              background: "radial-gradient(circle, rgba(255, 215, 220, 0.7) 0%, rgba(255, 255, 255, 0) 70%)",
              filter: "blur(10px)",
            }}
          />
          <Image
            src="/illustrazioni/scarpe.webp"
            alt="Scarpe da corsa"
            width={130}
            height={130}
            priority
            style={{
              objectFit: "contain",
              filter: "drop-shadow(0 14px 24px rgba(28, 26, 22, 0.13))",
            }}
          />
        </div>

        <h1
          style={{
            fontSize: 27,
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.18,
            margin: "0 0 10px",
            color: "var(--inchiostro)",
          }}
        >
          Benvenuto su Passo
        </h1>

        <p
          style={{
            fontSize: 14.5,
            lineHeight: 1.45,
            color: "var(--inchiostro-70)",
            margin: "0 0 28px",
            maxWidth: 320,
          }}
        >
          Il tuo piano di allenamento intelligente, che si adatta ogni giorno al tuo stato di forma.
        </p>

        {/* Feature Badges */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 10,
            width: "100%",
            maxWidth: 340,
            marginBottom: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 15px",
              background: "var(--crema-card)",
              borderRadius: "var(--radius-row)",
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              textAlign: "left",
            }}
          >
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "var(--sabbia-chip)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", color: "var(--inchiostro)" }}>
              <RunnerIcon size={16} strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Adattamento reale</p>
              <p style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>Se sei stanco o hai dolore, il piano scala</p>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "11px 15px",
              background: "var(--crema-card)",
              borderRadius: "var(--radius-row)",
              border: "var(--border-airbnb)",
              boxShadow: "var(--shadow-airbnb-subtle)",
              textAlign: "left",
            }}
          >
            <WatchIcon size={20} strokeWidth={1.8} style={{ color: "var(--azzurro-scuro)", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Garmin & Strava</p>
              <p style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>Sincronizzazione automatica delle attività</p>
            </div>
          </div>
        </div>

        {/* Error message if any */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            style={{
              padding: "10px 16px",
              background: "var(--rosa-avviso)",
              color: "var(--rosso-avviso)",
              borderRadius: "var(--radius-pill)",
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            {error}
          </motion.div>
        )}

        {/* High-end Google Button */}
        <motion.button data-track="login.handlesignin"
          type="button"
          onClick={handleSignIn}
          {...dis(pending, "in_caricamento")}
          whileTap={{ scale: 0.97 }}
          whileHover={{ scale: 1.015, y: -1, boxShadow: "0 8px 24px rgba(0,0,0,0.08)" }}
          transition={{ type: "spring", stiffness: 450, damping: 25 }}
          style={{
            width: "100%",
            maxWidth: 340,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: "15px 22px",
            background: "#ffffff",
            color: "#1f2937",
            border: "1.5px solid #e5e7eb",
            borderRadius: "var(--radius-pill)",
            fontSize: 15,
            fontWeight: 600,
            cursor: pending ? "default" : "pointer",
            boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
            opacity: pending ? 0.75 : 1,
          }}
        >
          {pending ? (
            <span style={{ fontSize: 14, color: "var(--inchiostro-50)" }}>Accesso in corso...</span>
          ) : (
            <>
              <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
                />
                <path
                  fill="#34A853"
                  d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 10.03 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
                />
                <path
                  fill="#EA4335"
                  d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                />
              </svg>
              <span>Continua con Google</span>
            </>
          )}
        </motion.button>

        <button data-track="login.signindev"
          type="button"
          onClick={() => signInDev()}
          style={{
            marginTop: 14,
            background: "transparent",
            border: "none",
            color: "var(--inchiostro-50)",
            fontSize: 12,
            textDecoration: "underline",
            cursor: "pointer",
            padding: "6px 12px",
          }}
        >
          Accedi in locale (Modalità Sviluppo)
        </button>
      </motion.div>

      {/* Footer Info */}
      <div style={{ textAlign: "center", padding: "10px 0 0" }}>
        <p
          style={{
            fontSize: 12,
            color: "var(--inchiostro-50)",
            margin: 0,
          }}
        >
          Nessun abbonamento richiesto · I tuoi dati restano tuoi
        </p>
      </div>
    </div>
  );
}
