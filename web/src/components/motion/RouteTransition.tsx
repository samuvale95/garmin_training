"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMotionEnabled } from "@/lib/motion";

const EASE = [0.22, 1, 0.36, 1] as const;

// Screens 04, 05, 14 -- the "still zone" (MOTION.md §1.4/§3.2): navigating into them is
// a pure cross-fade, never a directional push, and they run no entrance cascade.
const STILL_ZONE_PATHS = ["/diff", "/confirm-deletions", "/rate-limit"];
// Oggi / Settimana / Corpo -- tab switches are a cross-fade + slight rise, never a
// directional push (MOTION.md §3.2's "Cambio di tab" row).
const TAB_PATHS = ["/today", "/week", "/body"];

export function isStillZoneRoute(pathname: string): boolean {
  return STILL_ZONE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function isTabRoute(pathname: string): boolean {
  return TAB_PATHS.some((p) => pathname === p);
}

// Exits are deliberately shorter than entrances: the outgoing screen gets out of the way
// while the incoming one is already arriving (see the `mode="popLayout"` note below).
const pushVariants = {
  initial: { x: 24, opacity: 0 },
  animate: { x: 0, opacity: 1, transition: { duration: 0.28, ease: EASE } },
  exit: { x: -16, opacity: 0, transition: { duration: 0.16, ease: EASE } },
};

const fadeVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, transition: { duration: 0.14, ease: EASE } },
};

const tabVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.14, ease: EASE } },
};

const reducedVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.16 } },
  exit: { opacity: 0, transition: { duration: 0.16 } },
};

export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { reduced } = useMotionEnabled();
  const stillZone = isStillZoneRoute(pathname);

  const variants = reduced
    ? reducedVariants
    : stillZone
      ? fadeVariants
      : isTabRoute(pathname)
        ? tabVariants
        : pushVariants;

  // `mode="popLayout"` rather than `mode="wait"`: "wait" refuses to mount the incoming
  // screen until the outgoing one has finished exiting, so every navigation began with a
  // guaranteed ~0.3s of nothing on screen *before* the new page even started loading its
  // data. "popLayout" takes the exiting screen out of the flow so the two overlap -- the
  // new screen (with its skeletons) is there immediately, and no layout jump.
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={pathname}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={variants}
        data-still={stillZone ? "true" : undefined}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
