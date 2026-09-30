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
  const glyph = backHref ? "←" : "⌂";

  return (
    <motion.div
      whileHover={reduced ? undefined : { scale: 1.15, x: backHref ? -2 : 0 }}
      whileTap={reduced ? undefined : { scale: 0.85 }}
      transition={{ type: "spring", stiffness: 450, damping: 22 }}
      style={{ display: "inline-flex" }}
    >
      <Link
        href={href}
        className="tap-target page-back"
        aria-label={label}
        style={{
          color,
          fontSize: 20,
          textDecoration: "none",
          flex: "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: "50%",
          background: "var(--sabbia-chip)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        {glyph}
      </Link>
    </motion.div>
  );
}
