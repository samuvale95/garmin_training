"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useMotionEnabled } from "@/lib/motion";
import { MoveWarningSheet } from "@/components/MoveWarningSheet";
import { OfflineBanner } from "@/components/OfflineBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { RouteTransition } from "@/components/motion/RouteTransition";
import { TrackerProvider } from "@/components/TrackerProvider";
import { SmoothScroll } from "@/components/SmoothScroll";

export function AppShell({ children }: { children: ReactNode }) {
  const { reduced } = useMotionEnabled();
  const pathname = usePathname();
  const workspace = pathname.startsWith("/week/") || ["/today", "/week", "/week/programs", "/week/goals", "/activities", "/body", "/body/load", "/body/conflict", "/nutrition"].includes(pathname);
  return (
    <div className="app-shell" data-workspace={workspace || undefined} data-motion={reduced ? "reduced" : undefined}>
      <OfflineBanner />
      <TrackerProvider />
      {!workspace && <SmoothScroll />}
      <RouteTransition>{children}</RouteTransition>
      <MoveWarningSheet />
      <InstallPrompt />
    </div>
  );
}
