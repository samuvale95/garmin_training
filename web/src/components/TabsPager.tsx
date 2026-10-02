"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";
import { TodayView } from "@/components/tabs-views/TodayView";
import { WeekView } from "@/components/tabs-views/WeekView";
import { BodyView } from "@/components/tabs-views/BodyView";

const TAB_ROUTES = ["/today", "/week", "/body"] as const;

/**
 * True 3-Panel Continuous Tabs Pager.
 *
 * All three tabs (Oggi, Settimana, Corpo) are mounted side-by-side in a 300% width track.
 * During swipe gestures, the finger drags the entire track in real-time (1:1 tracking),
 * so the user physically sees the next screen sliding in simultaneously under their finger.
 * Upon release, it snaps with fluid, creamy spring physics (iOS / Airbnb style)
 * and syncs with Next.js router & TabBar.
 */
export function TabsPager({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { reduced } = useMotionEnabled();

  const isMainTab = pathname === "/today" || pathname === "/week" || pathname === "/body";

  const getIndexFromPath = useCallback((path: string): number => {
    if (path === "/week") return 1;
    if (path === "/body") return 2;
    return 0; // Default to /today
  }, []);

  const activeIdx = getIndexFromPath(pathname);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Track position in percentage: 0% = Oggi, -100% = Settimana, -200% = Corpo
  const targetX = -activeIdx * 100;
  const xPercent = useMotionValue(targetX);

  const startX = useRef(0);
  const startY = useRef(0);
  const isDragging = useRef(false);
  const isHorizontalScroll = useRef<boolean | null>(null);

  // Sync track position when route changes (e.g. user taps a TabBar link)
  useEffect(() => {
    if (!isDragging.current) {
      animate(xPercent, targetX, {
        type: "spring",
        stiffness: 420,
        damping: 34,
        mass: 0.8,
      });
    }
  }, [targetX, xPercent]);

  // A tab change starts the new tab from its top, as a page navigation would; the
  // neighbour was already showing its top while pinned (see the panels below).
  const previousIdx = useRef(activeIdx);
  useEffect(() => {
    if (previousIdx.current !== activeIdx) {
      previousIdx.current = activeIdx;
      window.scrollTo({ top: 0 });
    }
  }, [activeIdx]);

  // Touch gesture listeners
  const handleTouchStart = (e: React.TouchEvent) => {
    if (reduced || e.touches.length !== 1) return;
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

    // Detect horizontal vs vertical scroll intent
    if (isHorizontalScroll.current === null) {
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      if (absDx > 8 || absDy > 8) {
        if (absDx > absDy * 1.25) {
          isHorizontalScroll.current = true;
        } else {
          isHorizontalScroll.current = false;
        }
      }
    }

    if (isHorizontalScroll.current) {
      const width = containerRef.current?.offsetWidth || window.innerWidth || 390;
      let dxPercent = (dx / width) * 100;

      // Elastic resistance at the edges (Oggi moving right, or Corpo moving left)
      if ((activeIdx === 0 && dx > 0) || (activeIdx === 2 && dx < 0)) {
        dxPercent *= 0.28;
      }

      xPercent.set(targetX + dxPercent);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!isDragging.current) return;
    isDragging.current = false;

    if (!isHorizontalScroll.current) {
      animate(xPercent, targetX, {
        type: "spring",
        stiffness: 450,
        damping: 32,
      });
      return;
    }

    const currentX = xPercent.get();
    const width = containerRef.current?.offsetWidth || window.innerWidth || 390;
    const deltaPercent = currentX - targetX;

    // Threshold to switch page is 18% drag distance
    let newIdx = activeIdx;
    if (deltaPercent < -18 && activeIdx < 2) {
      newIdx = activeIdx + 1;
    } else if (deltaPercent > 18 && activeIdx > 0) {
      newIdx = activeIdx - 1;
    }

    if (newIdx !== activeIdx) {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(8);
      }
      // Animate track to target tab with responsive spring
      animate(xPercent, -newIdx * 100, {
        type: "spring",
        stiffness: 420,
        damping: 34,
        mass: 0.8,
      });
      // Synchronize URL
      router.push(TAB_ROUTES[newIdx]);
    } else {
      // Snap back to current tab
      animate(xPercent, targetX, {
        type: "spring",
        stiffness: 450,
        damping: 32,
      });
    }
  };

  // The track is 300% wide, and a percentage translate is relative to the element itself,
  // so one tab (100% of the viewport) is a third of the track.
  const xTransform = useTransform(xPercent, (val) => `${val / 3}%`);

  if (!isMainTab) {
    return <>{children}</>;
  }

  const views = [<TodayView key="today" />, <WeekView key="week" />, <BodyView key="body" />];

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
      style={{
        width: "100%",
        flex: 1,
        display: "flex",
        // `clip`, not `hidden`: hidden makes this a scroll container, which would turn
        // every `position: sticky` inside the tabs (the week header) into a no-op.
        overflowX: "clip",
        position: "relative",
      }}
    >
      <motion.div
        style={{
          display: "flex",
          alignItems: "flex-start",
          width: "300%",
          // Never `flex: 1` here: a 0 basis plus shrink squeezes the 300% track back to
          // the viewport width and all three tabs end up side by side on the first.
          flex: "none",
          x: xTransform,
          willChange: "transform",
        }}
      >
        {views.map((view, index) => {
          const active = index === activeIdx;
          return (
            <div
              key={index}
              aria-hidden={!active}
              style={{
                width: "33.333333%",
                flexShrink: 0,
                // The page scrolls with the window, sized by the active tab alone. The
                // other two are cut to one screen and pinned to the viewport, so the
                // neighbour peeking in during a swipe shows its top wherever the
                // current tab is scrolled to.
                ...(active
                  ? { minHeight: "100%" }
                  : { position: "sticky", top: 0, maxHeight: "100dvh", overflow: "hidden" }),
              }}
            >
              {view}
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}
