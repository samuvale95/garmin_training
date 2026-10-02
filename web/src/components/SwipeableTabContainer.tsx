"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

const TAB_ROUTES = ["/today", "/week", "/body"] as const;

/**
 * Interactive touch-following tab pager.
 * As your finger drags horizontally, the current and adjacent screens follow 1:1,
 * revealing the next screen seamlessly with soft Airbnb spring physics on release.
 */
export function SwipeableTabContainer({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { reduced } = useMotionEnabled();

  const activeTabIdx = TAB_ROUTES.findIndex(
    (tab) => pathname === tab || pathname.startsWith(`${tab}/`)
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const startX = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const isHorizontalScroll = useRef<boolean | null>(null);

  // Motion value representing the interactive drag offset in pixels (-width to +width)
  const dragX = useMotionValue(0);

  // Smooth, springy resistance and slight scale/opacity softening like iOS/Airbnb
  const opacity = useTransform(dragX, [-250, 0, 250], [0.94, 1, 0.94]);
  const scale = useTransform(dragX, [-250, 0, 250], [0.985, 1, 0.985]);

  // Prefetch adjacent routes so navigation is 0ms / instantaneous
  useEffect(() => {
    if (activeTabIdx > 0) {
      router.prefetch(TAB_ROUTES[activeTabIdx - 1]);
    }
    if (activeTabIdx < TAB_ROUTES.length - 1) {
      router.prefetch(TAB_ROUTES[activeTabIdx + 1]);
    }
  }, [activeTabIdx, router]);

  // Reset drag position on route change
  useEffect(() => {
    dragX.set(0);
    isDragging.current = false;
    isHorizontalScroll.current = null;
  }, [pathname, dragX]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (reduced || e.touches.length !== 1 || activeTabIdx === -1) return;
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    isDragging.current = true;
    isHorizontalScroll.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX.current;
    const dy = touch.clientY - startY.current;

    // Determine direction intent on first significant movement
    if (isHorizontalScroll.current === null) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx > 8 || absDy > 8) {
        if (absDx > absDy * 1.3) {
          isHorizontalScroll.current = true;
        } else {
          isHorizontalScroll.current = false;
        }
      }
    }

    if (isHorizontalScroll.current) {
      // Elastic rubber-band resistance if at the boundary tabs
      let effectiveDx = dx;
      if (
        (activeTabIdx === 0 && dx > 0) ||
        (activeTabIdx === TAB_ROUTES.length - 1 && dx < 0)
      ) {
        effectiveDx = dx * 0.25; // Rubber-band effect
      }
      dragX.set(effectiveDx);
    }
  };

  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (!isHorizontalScroll.current) {
      dragX.set(0);
      return;
    }

    const currentX = dragX.get();
    const containerWidth = containerRef.current?.offsetWidth || 390;
    const threshold = containerWidth * 0.20; // 20% drag threshold to switch

    if (currentX < -threshold && activeTabIdx < TAB_ROUTES.length - 1) {
      // Complete swipe Left -> animate out and navigate to next tab
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(8);
      }
      animate(dragX, -containerWidth, {
        type: "spring",
        stiffness: 420,
        damping: 34,
        onComplete: () => {
          router.push(TAB_ROUTES[activeTabIdx + 1]);
        },
      });
    } else if (currentX > threshold && activeTabIdx > 0) {
      // Complete swipe Right -> animate out and navigate to prev tab
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(8);
      }
      animate(dragX, containerWidth, {
        type: "spring",
        stiffness: 420,
        damping: 34,
        onComplete: () => {
          router.push(TAB_ROUTES[activeTabIdx - 1]);
        },
      });
    } else {
      // Snap back softly with gentle Airbnb spring physics
      animate(dragX, 0, {
        type: "spring",
        stiffness: 400,
        damping: 30,
      });
    }
  };

  const TAB_NAMES = ["Oggi", "Settimana", "Corpo"] as const;
  const prevTabName = activeTabIdx > 0 ? TAB_NAMES[activeTabIdx - 1] : null;
  const nextTabName = activeTabIdx < TAB_NAMES.length - 1 ? TAB_NAMES[activeTabIdx + 1] : null;

  // Peek panel transforms
  const peekLeftOpacity = useTransform(dragX, [0, 80, 200], [0, 0.45, 0.95]);
  const peekRightOpacity = useTransform(dragX, [-200, -80, 0], [0.95, 0.45, 0]);

  if (activeTabIdx === -1) {
    return <>{children}</>;
  }

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        width: "100%",
        position: "relative",
        overflowX: "clip",
      }}
    >
      {/* Adjacent peek preview: Left (Previous tab) */}
      {prevTabName && (
        <motion.div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            width: "100%",
            transform: "translateX(-100%)",
            x: dragX,
            opacity: peekLeftOpacity,
            pointerEvents: "none",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            justifyContent: "flex-start",
            padding: "24px 20px",
          }}
        >
          <div
            style={{
              background: "var(--crema-card)",
              borderRadius: "var(--radius-card-lg)",
              padding: "16px 20px",
              boxShadow: "var(--shadow-airbnb-subtle)",
              border: "var(--border-airbnb)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 40,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--inchiostro)" }}>
              ← {prevTabName}
            </span>
          </div>
        </motion.div>
      )}

      {/* Adjacent peek preview: Right (Next tab) */}
      {nextTabName && (
        <motion.div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            right: 0,
            width: "100%",
            transform: "translateX(100%)",
            x: dragX,
            opacity: peekRightOpacity,
            pointerEvents: "none",
            zIndex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            justifyContent: "flex-start",
            padding: "24px 20px",
          }}
        >
          <div
            style={{
              background: "var(--crema-card)",
              borderRadius: "var(--radius-card-lg)",
              padding: "16px 20px",
              boxShadow: "var(--shadow-airbnb-subtle)",
              border: "var(--border-airbnb)",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              marginTop: 40,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: "var(--inchiostro)" }}>
              {nextTabName} →
            </span>
          </div>
        </motion.div>
      )}

      {/* Active Tab Screen */}
      <motion.div
        style={{
          x: dragX,
          opacity,
          scale,
          width: "100%",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          transformOrigin: "center center",
          willChange: "transform, opacity",
          position: "relative",
          zIndex: 2,
        }}
      >
        {children}
      </motion.div>
    </div>
  );
}
