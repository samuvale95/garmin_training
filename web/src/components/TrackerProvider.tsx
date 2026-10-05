"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { consumeTabMethod, installTracker, resetScrollDepth, startScreenLoad, track } from "@/lib/tracker";

const TAB_PATHS = ["/today", "/week", "/body", "/nutrition"];

function tabOf(path: string): string | null {
  return TAB_PATHS.find((tab) => path === tab || path.startsWith(`${tab}/`)) ?? null;
}

/** Mounts the interaction tracker once and reports route changes: `screen_view` for every
 * one, plus `tab_change` when the move is between two of the four main tabs. */
export function TrackerProvider() {
  const pathname = usePathname();
  const previous = useRef<string | null>(null);

  useEffect(() => installTracker(), []);

  useEffect(() => {
    const from = previous.current;
    previous.current = pathname;
    resetScrollDepth();
    track("screen_view", pathname, from ? { referrer: from } : undefined);
    startScreenLoad(pathname);
    const fromTab = from && tabOf(from);
    const toTab = tabOf(pathname);
    if (fromTab && toTab && fromTab !== toTab) {
      track("tab_change", toTab, { from: fromTab, to: toTab, method: consumeTabMethod() });
    }
  }, [pathname]);

  return null;
}
