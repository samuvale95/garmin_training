"use client";

import { ViewTransition, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useMotionEnabled } from "@/lib/motion";

// Screens 04, 05, 14 -- the "still zone" (MOTION.md §1.4/§3.2): navigating into them is
// a pure cross-fade, never a directional push, and they run no entrance cascade.
const STILL_ZONE_PATHS = ["/diff", "/confirm-deletions", "/rate-limit"];

// Oggi / Settimana / Corpo -- the three routes that share the (tabs) layout and its
// TabBar. Switching between them is a cross-fade + slight rise, never a directional
// push (MOTION.md §3.2's "Cambio di tab" row).
const TAB_GROUP_PATHS = ["/today", "/week", "/body"];

// /watch-sync isn't navigated *to*, it takes Oggi's place, so it gets the tab flavor
// too -- but it lives outside the (tabs) layout, so it keeps its own transition key.
const TAB_FLAVOR_PATHS = [...TAB_GROUP_PATHS, "/watch-sync"];

/** Shared key for the three tabs -- see `routeKey`. */
const TAB_GROUP_KEY = "__tabs__";

export function isStillZoneRoute(pathname: string): boolean {
  return STILL_ZONE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** True for the three tab routes themselves, not for pages nested under them
 * (/body/conflict, /week/new): those are pushes that happen to sit inside the layout. */
export function isTabRoute(pathname: string): boolean {
  return TAB_GROUP_PATHS.includes(pathname);
}

/**
 * The three tabs collapse to one key so the *root* transition doesn't fire when you
 * switch tabs -- otherwise the whole (tabs) layout, TabBar included, would be torn down
 * and remounted on every tab tap. That both slid the bar around (it should be the one
 * fixed reference point on screen) and broke the pill's `layoutId` morph, which needs
 * the old and new TabBar to be the same React instance. Tab-to-tab motion is handled one
 * level down by `TabContentTransition`, which only wraps the page body.
 */
function routeKey(pathname: string): string {
  return isTabRoute(pathname) ? TAB_GROUP_KEY : pathname;
}

/** Class name driving the ::view-transition-old/new rules in globals.css. */
type Flavor = "none" | "vt-fade" | "vt-tab" | "vt-push";

function flavorFor(pathname: string, reduced: boolean): Flavor {
  if (reduced) return "none";
  if (isStillZoneRoute(pathname)) return "vt-fade";
  if (TAB_FLAVOR_PATHS.includes(pathname)) return "vt-tab";
  return "vt-push";
}

/**
 * Root-level page transition.
 *
 * This used to be framer-motion's `AnimatePresence`, which had two problems no amount of
 * tuning fixes. First, keeping the outgoing screen on-screen means keeping it in the DOM,
 * and `mode="popLayout"` pins it by measuring it (a forced synchronous layout of the whole
 * document at the exact moment React is mounting the next screen) -- while `mode="wait"`
 * instead guarantees a blank gap the length of the exit. Second, Next resets the window
 * scroll on navigation, so an outgoing screen still laid out in the document snaps to its
 * top mid-animation: from halfway down Settimana, the exit visibly jumped.
 *
 * `<ViewTransition>` sidesteps both. The browser captures the outgoing screen as an image
 * in *viewport* coordinates before React commits, so it stays exactly where the user saw
 * it regardless of scroll, and both snapshots are animated by the compositor rather than
 * by JS competing with the incoming screen's render.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { reduced } = useMotionEnabled();
  const stillZone = isStillZoneRoute(pathname);
  const flavor = flavorFor(pathname, reduced);

  // `default="none"` keeps this boundary out of unrelated transitions -- without it the
  // root would also animate whenever the nested tab transition runs.
  return (
    <ViewTransition key={routeKey(pathname)} enter={flavor} exit={flavor} default="none">
      <div data-still={stillZone ? "true" : undefined}>{children}</div>
    </ViewTransition>
  );
}

/**
 * Tab-to-tab transition, mounted inside the (tabs) layout so it wraps the page body only
 * and leaves the TabBar untouched (see `routeKey`). Pages nested under a tab pass straight
 * through: they're pushes, and the root transition already owns them.
 */
export function TabContentTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { reduced } = useMotionEnabled();

  if (!isTabRoute(pathname)) return <>{children}</>;

  // A shared `name` (plus `share`, and no enter/exit) rather than enter/exit: it means the
  // only thing that animates here is one tab handing over to another. Navigating *out* of
  // the tab group -- to /body/conflict, /week/new -- unmounts this boundary, and with no
  // `exit` class it falls back to `default="none"` and stays still, leaving the push to
  // the root transition instead of running a second animation underneath it.
  return (
    <ViewTransition key={pathname} name="tab-content" share={reduced ? "none" : "vt-tab"} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
