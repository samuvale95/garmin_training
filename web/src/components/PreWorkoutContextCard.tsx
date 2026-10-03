"use client";

import { motion } from "framer-motion";
import { SlideUp } from "@/components/motion/primitives";
import { LightningIcon } from "@/components/Icons";
import { calculateHydrationMl, calculateSnackGrams } from "@/lib/notifications";
import type { DayTarget } from "@/lib/types";

interface PreWorkoutContextCardProps {
  todayTarget?: DayTarget | null;
  onOpenQuickLog: () => void;
  active?: boolean;
  trained?: boolean;
  carbLoggedG?: number;
  entriesCount?: number;
  dateKey?: string;
}

export function PreWorkoutContextCard({
  todayTarget,
  onOpenQuickLog,
  active = true,
  trained = false,
  carbLoggedG = 0,
  entriesCount = 0,
  dateKey,
}: PreWorkoutContextCardProps) {
  // Check if manually dismissed today in localStorage
  const storageKey = dateKey ? `passo:preworkout_dismissed:${dateKey}` : null;
  const isDismissed = typeof window !== "undefined" && storageKey ? localStorage.getItem(storageKey) === "true" : false;

  // Hide if no target, rest day, workout is already completed for today, or manually dismissed
  if (!todayTarget || todayTarget.load === "riposo" || trained || isDismissed) {
    return null;
  }

  // If user already logged ANY meal/snack today or reached carb threshold, hide card
  if (entriesCount > 0 || carbLoggedG > 0) {
    return null;
  }

  const isLongOrHard = todayTarget.load === "molto_lungo" || todayTarget.load === "duro";
  const snackGramsText = calculateSnackGrams(todayTarget.load);
  const hydrationMl = calculateHydrationMl(isLongOrHard ? 90 : 45, isLongOrHard);

  return (
    <SlideUp active={active} delayMs={130} style={{ marginTop: 12 }}>
      <div
        style={{
          background: "var(--crema-card)",
          border: "1px solid rgba(255, 111, 89, 0.28)",
          boxShadow: "var(--shadow-airbnb-subtle)",
          borderRadius: "var(--radius-card)",
          padding: "14px 16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
            <LightningIcon size={13} strokeWidth={2.2} style={{ color: "var(--corallo-accent)" }} />
            <span
              className="font-mono"
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: ".06em",
                color: "var(--corallo-testo)",
              }}
            >
              Fabbisogno Pre-Corsa
            </span>
          </div>
          <p style={{ font: "600 14px/1.2 var(--font-sans)", margin: "2px 0 0", color: "var(--inchiostro)" }}>
            ~{snackGramsText} carboidrati · {hydrationMl}ml acqua
          </p>
          <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>
            Mangia 60–90 min prima per massimizzare la resa
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.94 }}
          onClick={onOpenQuickLog}
          className="tap-target"
          style={{
            flexShrink: 0,
            background: "var(--corallo)",
            color: "var(--corallo-testo)",
            border: "none",
            borderRadius: 12,
            padding: "8px 12px",
            fontSize: 12.5,
            fontWeight: 600,
            cursor: "pointer",
            boxShadow: "0 2px 8px rgba(255, 111, 89, 0.25)",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span>+ Snack</span>
        </motion.button>
      </div>
    </SlideUp>
  );
}
