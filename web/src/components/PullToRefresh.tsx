"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { BrandMark } from "@/components/motion/BrandMark";
import { useMotionEnabled } from "@/lib/motion";

interface PullToRefreshProps {
  onRefresh: () => Promise<unknown> | void;
  children: ReactNode;
}

const PULL_THRESHOLD = 72;
const MAX_PULL = 110;

export function PullToRefresh({ onRefresh, children }: PullToRefreshProps) {
  const { reduced } = useMotionEnabled();
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const isPulling = useRef(false);
  const pullDistance = useMotionValue(0);

  const opacity = useTransform(pullDistance, [0, 24, PULL_THRESHOLD], [0, 0.4, 1]);
  const scale = useTransform(pullDistance, [0, PULL_THRESHOLD], [0.8, 1.05]);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (refreshing || reduced) return;
      // Only initiate pull-to-refresh if user is at the very top of the scrollable container
      const scrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      if (scrollTop <= 1) {
        startY.current = e.touches[0].clientY;
        isPulling.current = true;
      }
    },
    [refreshing, reduced]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!isPulling.current || refreshing) return;
      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;

      if (diff > 0) {
        // Logarithmic / damped resistance curve
        const distance = Math.min(MAX_PULL, diff * 0.45);
        pullDistance.set(distance);
      } else {
        pullDistance.set(0);
        isPulling.current = false;
      }
    },
    [pullDistance, refreshing]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling.current || refreshing) return;
    isPulling.current = false;

    const currentDistance = pullDistance.get();
    if (currentDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      // Haptic confirmation if available
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(12);
      }
      // Hold indicator at threshold height while refreshing
      animate(pullDistance, PULL_THRESHOLD, { type: "spring", stiffness: 350, damping: 28 });
      try {
        await onRefresh();
      } finally {
        animate(pullDistance, 0, {
          type: "spring",
          stiffness: 400,
          damping: 30,
          onComplete: () => setRefreshing(false),
        });
      }
    } else {
      animate(pullDistance, 0, { type: "spring", stiffness: 450, damping: 32 });
    }
  }, [pullDistance, refreshing, onRefresh]);

  return (
    <div
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ position: "relative", minHeight: "100%" }}
    >
      {/* Brand mark pull indicator container */}
      <motion.div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: PULL_THRESHOLD,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
          zIndex: 40,
          opacity,
          scale,
          y: useTransform(pullDistance, (val) => val - 50),
        }}
      >
        <div
          style={{
            background: "var(--crema-card)",
            padding: "8px 14px",
            borderRadius: "var(--radius-pill)",
            border: "var(--border-airbnb)",
            boxShadow: "var(--shadow-airbnb)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <BrandMark height={20} forceStatic={!refreshing} />
          {refreshing && (
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "var(--inchiostro-50)" }}>
              Aggiornamento...
            </span>
          )}
        </div>
      </motion.div>

      {/* Main content pushed downwards smoothly with touch drag */}
      <motion.div style={{ y: pullDistance }}>
        {children}
      </motion.div>
    </div>
  );
}
