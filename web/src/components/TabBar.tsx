"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

const TABS = [
  { href: "/today", label: "Oggi", path: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10" },
  { href: "/week", label: "Settimana", path: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M7 14h2m6 0h2M7 18h2" },
  { href: "/body", label: "Corpo", path: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  const { reduced } = useMotionEnabled();
  return (
    <nav className="tab-bar" aria-label="Navigazione principale">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <motion.div
            key={tab.href}
            whileTap={{ scale: 0.9 }}
            transition={{ type: "spring", stiffness: 500, damping: 25 }}
            style={{ flex: 1, display: "flex", justifyContent: "center" }}
          >
            <Link href={tab.href} className="tap-target tab-link" aria-current={active ? "page" : undefined}>
              {active && (reduced ? <span className="tab-indicator" /> :
                <motion.span className="tab-indicator" layoutId="tab-pill" transition={{ type: "spring", stiffness: 420, damping: 36 }} />)}
              <span className="tab-link-content">
                <motion.svg
                  width="23"
                  height="23"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                  animate={active && !reduced ? { scale: [1, 1.15, 1] } : { scale: 1 }}
                  // A tween, not a spring: springs only take two keyframes, and the error
                  // three of them throw lands inside framer-motion's shared frame loop --
                  // freezing every animation in the app, the tab swipe included.
                  transition={{ duration: 0.35, ease: "easeOut", times: [0, 0.4, 1] }}
                >
                  <path d={tab.path} />
                </motion.svg>
                <span>{tab.label}</span>
              </span>
            </Link>
          </motion.div>
        );
      })}
    </nav>
  );
}
