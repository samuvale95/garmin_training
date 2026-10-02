"use client";

import { useRef, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

const TAB_ROUTES = ["/today", "/week", "/body"] as const;

export function SwipeableTabContainer({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { reduced } = useMotionEnabled();

  const startTouch = useRef<{ x: number; y: number; time: number } | null>(null);
  const activeTabIdx = TAB_ROUTES.findIndex(
    (tab) => pathname === tab || pathname.startsWith(`${tab}/`)
  );

  const prevIdx = useRef(activeTabIdx >= 0 ? activeTabIdx : 0);
  const direction = activeTabIdx >= prevIdx.current ? 1 : -1;
  prevIdx.current = activeTabIdx >= 0 ? activeTabIdx : 0;

  const handleTouchStart = (e: React.TouchEvent) => {
    if (reduced || e.touches.length !== 1) return;
    const touch = e.touches[0];
    startTouch.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!startTouch.current || activeTabIdx === -1) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startTouch.current.x;
    const dy = touch.clientY - startTouch.current.y;
    const elapsed = Date.now() - startTouch.current.time;
    startTouch.current = null;

    // Must be a predominantly horizontal flick:
    // 1. Min horizontal distance 52px
    // 2. Horizontal component at least 1.6x greater than vertical component
    // 3. Completed in less than 500ms
    if (
      Math.abs(dx) > 52 &&
      Math.abs(dx) > Math.abs(dy) * 1.6 &&
      elapsed < 500
    ) {
      if (dx < 0 && activeTabIdx < TAB_ROUTES.length - 1) {
        // Swipe Left -> next tab
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(8);
        }
        router.push(TAB_ROUTES[activeTabIdx + 1]);
      } else if (dx > 0 && activeTabIdx > 0) {
        // Swipe Right -> previous tab
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(8);
        }
        router.push(TAB_ROUTES[activeTabIdx - 1]);
      }
    }
  };

  if (activeTabIdx === -1) {
    return <>{children}</>;
  }

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        width: "100%",
        position: "relative",
      }}
    >
      <AnimatePresence mode="popLayout" initial={false} custom={direction}>
        <motion.div
          key={pathname}
          custom={direction}
          initial={{
            opacity: 0,
            x: direction > 0 ? 30 : -30,
            scale: 0.98,
          }}
          animate={{
            opacity: 1,
            x: 0,
            scale: 1,
          }}
          exit={{
            opacity: 0,
            x: direction > 0 ? -30 : 30,
            scale: 0.98,
          }}
          transition={{
            type: "spring",
            stiffness: 380,
            damping: 32,
            mass: 0.7,
          }}
          style={{
            width: "100%",
            flex: 1,
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
