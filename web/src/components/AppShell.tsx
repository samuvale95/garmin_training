"use client";

import type { ReactNode } from "react";
import { useMotionEnabled } from "@/lib/motion";
import { MoveWarningSheet } from "@/components/MoveWarningSheet";
import { RouteTransition } from "@/components/motion/RouteTransition";
import { SmoothScroll } from "@/components/SmoothScroll";

export function AppShell({ children }: { children: ReactNode }) {
  const { reduced } = useMotionEnabled();
  return (
    <div className="app-shell" data-motion={reduced ? "reduced" : undefined}>
      <SmoothScroll />
      <RouteTransition>{children}</RouteTransition>
      <MoveWarningSheet />
    </div>
  );
}
