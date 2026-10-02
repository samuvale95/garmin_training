"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CloudOffIcon } from "@/components/Icons";
import { useIsOnline } from "@/lib/useOnline";

/** Screen-top non-modal offline banner (per OpenSpec passo-nextjs-web-app task 11.3).
 *
 * Appears gently when device loses connectivity, reassuring the athlete that all
 * cached sessions, nutrition, and recovery metrics remain available for reading,
 * and slides away seamlessly when connection resumes.
 */
export function OfflineBanner() {
  const isOnline = useIsOnline();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ y: -48, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -48, opacity: 0 }}
          transition={{ type: "spring", stiffness: 450, damping: 32 }}
          style={{
            position: "sticky",
            top: 0,
            zIndex: 9999,
            width: "100%",
            background: "var(--inchiostro)",
            color: "var(--crema)",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
          }}
        >
          <CloudOffIcon size={14} strokeWidth={2.2} style={{ color: "var(--corallo)", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 500, letterSpacing: "-.01em" }}>
            Modalità offline · <span style={{ opacity: 0.8 }}>i tuoi dati salvati restano disponibili</span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
