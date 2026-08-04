"use client";

import Link from "next/link";
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
    <Link
      href={href}
      className="tap-target"
      aria-label={label}
      style={{
        color,
        fontSize: 20,
        textDecoration: "none",
        flex: "none",
        transition: reduced ? undefined : "transform 120ms var(--ease)",
      }}
      onPointerDown={(e) => {
        if (reduced) return;
        e.currentTarget.style.transform = "scale(0.97)";
      }}
      onPointerUp={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
      onPointerLeave={(e) => {
        e.currentTarget.style.transform = "scale(1)";
      }}
    >
      {glyph}
    </Link>
  );
}
