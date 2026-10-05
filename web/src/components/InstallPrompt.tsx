"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShareIcon, DownloadIcon, CloseIcon } from "@/components/Icons";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    // Check if already installed / running standalone
    const isStandaloneMode =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsStandalone(isStandaloneMode);

    if (isStandaloneMode) return;

    // Check if user dismissed previously in this session/store
    const hasDismissed = localStorage.getItem("passo_pwa_dismissed");
    if (hasDismissed) return;

    // Detect iOS
    const ua = window.navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua) && !(window as unknown as { MSStream?: unknown }).MSStream;
    setIsIOS(isIOSDevice);

    if (isIOSDevice) {
      // Delay showing iOS prompt slightly to not bombard user immediately
      const timer = setTimeout(() => setDismissed(false), 2500);
      return () => clearTimeout(timer);
    }

    // Android / Desktop Chromium beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setDismissed(false);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      setDismissed(true);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("passo_pwa_dismissed", "true");
  };

  if (isStandalone || dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 28 }}
        style={{
          position: "fixed",
          bottom: "calc(env(safe-area-inset-bottom, 0px) + 72px)",
          left: 16,
          right: 16,
          maxWidth: 440,
          margin: "0 auto",
          zIndex: 9998,
          background: "var(--inchiostro)",
          color: "var(--crema)",
          borderRadius: "var(--radius-card)",
          padding: "14px 16px",
          boxShadow: "0 12px 36px rgba(0,0,0,0.28)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 13.5, fontWeight: 600, letterSpacing: "-.01em" }}>
            Installa Passo come App
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "var(--inchiostro-su-scuro)", lineHeight: 1.35 }}>
            {isIOS ? (
              <>
                Tocca <ShareIcon size={12} style={{ display: "inline", verticalAlign: "-1px", margin: "0 2px" }} /> e poi <strong>&ldquo;Aggiungi alla schermata Home&rdquo;</strong>
              </>
            ) : (
              "Accesso istantaneo 0ms e allenamenti sempre a portata di mano"
            )}
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {!isIOS && deferredPrompt && (
            <motion.button data-track="install-prompt.handleinstallclick"
              whileTap={{ scale: 0.94 }}
              onClick={handleInstallClick}
              style={{
                background: "var(--corallo-accent)",
                color: "#ffffff",
                border: "none",
                borderRadius: 12,
                padding: "8px 12px",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
              }}
            >
              <DownloadIcon size={13} strokeWidth={2.2} />
              <span>Installa</span>
            </motion.button>
          )}

          <button data-track="install-prompt.chiudi-avviso"
            onClick={handleDismiss}
            aria-label="Chiudi avviso"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--inchiostro-su-scuro)",
              padding: 4,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
            }}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
