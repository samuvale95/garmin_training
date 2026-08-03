"use client";

import type { ReactNode } from "react";
import { useMotionEnabled } from "@/lib/motion";
import { RouteTransition } from "@/components/motion/RouteTransition";

export function AppShell({ children }: { children: ReactNode }) {
  const { reduced } = useMotionEnabled();
  return (
    <div className="app-shell" data-motion={reduced ? "reduced" : undefined}>
      <RouteTransition>{children}</RouteTransition>
    </div>
  );
}
