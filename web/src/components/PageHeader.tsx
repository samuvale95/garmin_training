"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

interface PageHeaderProps {
  /** Predecessor step in the current flow. Omit when there is none -- renders a home link instead. */
  backHref?: string;
  color?: string;
}

/** Escape hatch every non-tab screen renders: back to the previous step, or home if there is none. */
export function PageHeader({ backHref, color = "var(--inchiostro)" }: PageHeaderProps) {
  const { reduced } = useMotionEnabled();
  const href = backHref ?? "/today";
  const label = backHref ? "Indietro" : "Torna alla home";
  return (
    <motion.div
      whileHover={reduced ? undefined : { scale: 1.08, x: backHref ? -2 : 0 }}
      whileTap={reduced ? undefined : { scale: 0.92 }}
      transition={{ type: "spring", stiffness: 450, damping: 22 }}
      style={{ display: "inline-flex" }}
    >
      <Link data-track="page-header.href"
        href={href}
        className="tap-target page-back"
        aria-label={label}
        style={{
          color,
          textDecoration: "none",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "50%",
          background: "var(--sabbia-chip)",
          border: "1px solid var(--border-airbnb)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        }}
      >
        {backHref ? (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        ) : (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
        )}
      </Link>
    </motion.div>
  );
}
