"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

const TABS = [
  { href: "/today", label: "Oggi" },
  { href: "/week", label: "Settimana" },
  { href: "/body", label: "Corpo" },
] as const;

export function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        position: "sticky",
        bottom: 0,
        display: "flex",
        gap: 4,
        background: "var(--inchiostro)",
        borderRadius: "var(--radius-pill)",
        padding: 6,
        margin: "0 20px 18px",
      }}
      aria-label="Navigazione principale"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className="tap-target"
            style={{
              position: "relative",
              flex: 1,
              textDecoration: "none",
              textAlign: "center",
              padding: "10px 0",
              borderRadius: "var(--radius-pill)",
              fontSize: 14,
              fontWeight: 600,
              color: active ? "var(--inchiostro)" : "var(--inchiostro-su-scuro)",
            }}
          >
            {active && (
              <motion.span
                layoutId="tab-pill"
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                style={{
                  position: "absolute",
                  inset: 0,
                  background: "var(--crema)",
                  borderRadius: "var(--radius-pill)",
                  zIndex: 0,
                }}
              />
            )}
            <span style={{ position: "relative", zIndex: 1 }}>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
