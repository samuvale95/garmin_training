"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { animate, useMotionValue, useMotionValueEvent } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";
import { markTabMethod } from "@/lib/tracker";
import { TodayView } from "@/components/tabs-views/TodayView";
import { WeekView } from "@/components/tabs-views/WeekView";
import { BodyView } from "@/components/tabs-views/BodyView";
import { NutritionView } from "@/components/tabs-views/NutritionView";

const TAB_ROUTES = ["/today", "/week", "/body", "/nutrition"] as const;

/**
 * True 4-Panel Continuous Tabs Pager.
 *
 * All four tabs (Oggi, Settimana, Corpo, Nutrizione) are mounted side-by-side in a 400% width track.
 * During swipe gestures, the finger drags the entire track in real-time (1:1 tracking),
 * so the user physically sees the next screen sliding in simultaneously under their finger.
 * Upon release, it snaps with fluid, creamy spring physics (iOS / Airbnb style)
 * and syncs with Next.js router & TabBar.
 */
export function TabsPager({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { reduced } = useMotionEnabled();

  const isMainTab = pathname === "/today" || pathname === "/week" || pathname === "/body" || pathname === "/nutrition";

  const getIndexFromPath = useCallback((path: string): number => {
    if (path === "/week") return 1;
    if (path === "/body") return 2;
    if (path === "/nutrition") return 3;
    return 0; // Default to /today
  }, []);

  // The tab shown, as local state rather than read off the URL: a swipe commits it on
  // release, in the same frame the snap starts, instead of whenever `router.push`
  // resolves -- which is hundreds of ms later and would swap the page layout mid-slide.
  // A URL change from elsewhere (TabBar tap, back button) still wins.
  const routeIdx = getIndexFromPath(pathname);
  const [activeIdx, setActiveIdx] = useState(routeIdx);
  const [syncedRouteIdx, setSyncedRouteIdx] = useState(routeIdx);
  if (routeIdx !== syncedRouteIdx) {
    setSyncedRouteIdx(routeIdx);
    setActiveIdx(routeIdx);
  }
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

  // Each tab keeps its own scroll position, like the tabs of a native app. The page
  // scrolls with the window, which only ever belongs to the active tab, so the other two
  // are one-screen boxes moved down to wherever the window is scrolled (always at the top
  // of the viewport) with their content shifted to their own remembered scroll -- which
  // is exactly what each will show once active, including the neighbour peeking in
  // during a swipe. Not `position: sticky`: sticky can't pass the end of the track, so
  // near the bottom of a page the neighbour sat higher than it would land.
  const scrollByTab = useRef([0, 0, 0, 0]);
  const shownIdx = useRef(activeIdx);
  const panelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const placePanels = useCallback(() => {
    const active = shownIdx.current;
    // Clamped to the active tab's real scroll range: iOS reports scrollY past the end
    // during the rubber-band bounce, and following it pushed the hidden tabs further
    // down, which grew the page, which let the next bounce go further -- an ever-longer
    // blank tail under the content.
    // (The page's own height is a safe bound: the pager clips, so the hidden tabs never
    // count towards it.)
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const y = Math.min(Math.max(window.scrollY, 0), maxY);
    panelRefs.current.forEach((el, index) => {
      if (el) el.style.transform = index === active ? "" : `translateY(${y}px)`;
    });
    contentRefs.current.forEach((el, index) => {
      if (el) el.style.transform = index === active ? "" : `translateY(${-scrollByTab.current[index]}px)`;
    });
  }, []);

  useEffect(() => {
    const onScroll = () => {
      scrollByTab.current[shownIdx.current] = window.scrollY;
      placePanels();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [placePanels]);

  // The swap itself, before the browser paints: the incoming tab joins the page flow and
  // the window jumps to its remembered scroll in the same frame, so it stays exactly
  // where it was on screen. Doing this a frame later (useEffect) is what made the new
  // page vanish and reappear mid-transition.
  useLayoutEffect(() => {
    shownIdx.current = activeIdx;
    window.scrollTo(0, scrollByTab.current[activeIdx]);
    placePanels();
  }, [activeIdx, placePanels]);

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

      // Elastic resistance at the edges (Oggi moving right, or Nutrizione moving left)
      if ((activeIdx === 0 && dx > 0) || (activeIdx === 3 && dx < 0)) {
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
    if (deltaPercent < -18 && activeIdx < 3) {
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
      // Commit the tab now, then let the URL catch up -- without Next's scroll-to-top
      // on navigation, which would land mid-slide and undo the tab's remembered scroll.
      setActiveIdx(newIdx);
      markTabMethod("swipe");
      router.push(TAB_ROUTES[newIdx], { scroll: false });
    } else {
      // Snap back to current tab
      animate(xPercent, targetX, {
        type: "spring",
        stiffness: 450,
        damping: 32,
      });
    }
  };

  // Where the track sits. While it moves (drag, snap) it is a GPU translate -- the track
  // is 400% wide and a % translate is relative to the element itself, so one tab is a
  // fourth of it (val / 4).
  const trackRef = useRef<HTMLDivElement | null>(null);
  const placeTrack = useCallback((val: number) => {
    const track = trackRef.current;
    if (!track) return;
    const atRest = !isDragging.current && val === -shownIdx.current * 100;
    track.style.transform = atRest ? "none" : `translateX(${val / 4}%)`;
    track.style.willChange = atRest ? "auto" : "transform";
    track.style.left = atRest ? `${val}%` : "0";
  }, []);
  useMotionValueEvent(xPercent, "change", placeTrack);
  useLayoutEffect(() => placeTrack(xPercent.get()), [activeIdx, placeTrack, xPercent]);

  if (!isMainTab) {
    return <>{children}</>;
  }

  const views = [
    <TodayView key="today" />,
    <WeekView key="week" />,
    <BodyView key="body" />,
    <NutritionView key="nutrition" />,
  ];

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
        overflow: "clip",
        touchAction: "pan-y",
        position: "relative",
      }}
    >
      <div
        ref={trackRef}
        style={{
          display: "flex",
          alignItems: "flex-start",
          width: "400%",
          flex: "none",
          position: "relative",
        }}
      >
        {views.map((view, index) => {
          const active = index === activeIdx;
          return (
            <div
              key={index}
              aria-hidden={!active}
              style={{
                width: "25%",
                flexShrink: 0,
                ...(active ? { minHeight: "100%" } : { height: "100dvh", overflow: "hidden" }),
              }}
              ref={(el) => {
                panelRefs.current[index] = el;
              }}
            >
              <div
                style={{ paddingBottom: "calc(84px + env(safe-area-inset-bottom, 0px))" }}
                ref={(el) => {
                  contentRefs.current[index] = el;
                }}
              >
                {view}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
