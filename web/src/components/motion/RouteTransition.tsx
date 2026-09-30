"use client";

import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useMotionEnabled } from "@/lib/motion";

// Screens 04, 05, 14 -- the "still zone" (MOTION.md §1.4/§3.2): navigating into them is
// a pure cross-fade, never a directional push.
const STILL_ZONE_PATHS = ["/diff", "/confirm-deletions", "/rate-limit"];

// Oggi / Settimana / Corpo -- the three routes that share the (tabs) layout and its
// TabBar. Switching between them is a cross-fade + slight rise, never a directional push.
const TAB_GROUP_PATHS = ["/today", "/week", "/body"];

const TAB_FLAVOR_PATHS = [...TAB_GROUP_PATHS, "/watch-sync"];

/** Shared key for the three tabs -- see `routeKey`. */
const TAB_GROUP_KEY = "__tabs__";

export function isStillZoneRoute(pathname: string): boolean {
  return STILL_ZONE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True for the three tab routes themselves, not for pages nested under them. */
export function isTabRoute(pathname: string): boolean {
  return TAB_GROUP_PATHS.includes(pathname);
}

/**
 * The three tabs collapse to one key so the root transition doesn't fire when you
 * switch tabs -- otherwise the whole (tabs) layout, TabBar included, would be torn down
 * and remounted on every tab tap. Tab-to-tab motion is handled one level down by
 * `TabContentTransition`, which only wraps the page body.
 */
function routeKey(pathname: string): string {
  return isTabRoute(pathname) ? TAB_GROUP_KEY : pathname;
}

/**
 * Root-level page transition with fluid spring physics.
 * Animates screen changes across the entire app smoothly on GPU compositing.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { reduced } = useMotionEnabled();
  const stillZone = isStillZoneRoute(pathname);
  const key = routeKey(pathname);

  if (reduced) {
    return <div data-still={stillZone ? "true" : undefined}>{children}</div>;
  }

  return (
    <motion.div
      key={key}
      initial={stillZone ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 340,
        damping: 28,
        mass: 0.6,
      }}
      data-still={stillZone ? "true" : undefined}
      style={{
        width: "100%",
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        flex: 1,
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Tab-to-tab transition, mounted inside the (tabs) layout so it wraps the page body only
 * and leaves the TabBar untouched. Animates switching between Oggi, Settimana, and Corpo
 * with silky-smooth spring physics.
 */
export function TabContentTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { reduced } = useMotionEnabled();

  if (!isTabRoute(pathname)) return <>{children}</>;

  if (reduced) return <div>{children}</div>;

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 340,
        damping: 28,
        mass: 0.6,
      }}
      style={{ width: "100%" }}
    >
      {children}
    </motion.div>
  );
}
