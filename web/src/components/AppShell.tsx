"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useMotionEnabled } from "@/lib/motion";
import { isBareRoute } from "@/lib/navigation";
import { MoveWarningSheet } from "@/components/MoveWarningSheet";
import { OfflineBanner } from "@/components/OfflineBanner";
import { InstallPrompt } from "@/components/InstallPrompt";
import { RouteTransition } from "@/components/motion/RouteTransition";
import { TrackerProvider } from "@/components/TrackerProvider";
import { Workspace } from "@/components/Workspace";

/** Entry and connection screens stand alone; every other screen sits in the frame, whose
 * navigation stays mounted while only the page content transitions. Scrolling is native. */
export function AppShell({ children }: { children: ReactNode }) {
  const { reduced } = useMotionEnabled();
  const pathname = usePathname();
  const bare = isBareRoute(pathname);
  return (
    <div className="app-shell" data-chrome={bare ? "bare" : "frame"} data-motion={reduced ? "reduced" : undefined}>
      <OfflineBanner />
      <TrackerProvider />
      {bare ? (
        <RouteTransition>{children}</RouteTransition>
      ) : (
        <Workspace>
          <RouteTransition>{children}</RouteTransition>
        </Workspace>
      )}
      <MoveWarningSheet />
      <InstallPrompt />
    </div>
  );
}
