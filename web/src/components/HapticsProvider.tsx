"use client";

import { useEffect } from "react";
import { haptic, type HapticKind } from "@/lib/haptics";

const KINDS: HapticKind[] = ["selection", "light", "medium", "heavy", "success", "warning", "error"];

// What counts as a control: anything pressed, toggled or chosen. Plain links (a card that
// opens a page) stay silent -- navigation is not an action, and a phone that buzzes on
// every tap stops meaning anything.
const CONTROL = 'button, [role="button"], [role="tab"], [role="switch"], [role="radio"], summary, select, input[type="checkbox"], input[type="radio"], [data-haptic]';

/** One click listener for the whole app, so every control answers the finger without
 * each component remembering to. `data-haptic="success"` (or any `HapticKind`) picks a
 * different feel, `data-haptic="none"` silences one; a disabled control (`aria-disabled`,
 * see `dis()`) gives a warning instead -- the tap was felt, and refused. */
export function HapticsProvider() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      // Only a finger: script clicks (including the hidden switch haptics.ts clicks to
      // play the iOS haptic) would otherwise answer themselves forever.
      if (!event.isTrusted) return;
      const target = event.target as Element | null;
      const control = target?.closest?.(CONTROL);
      if (!control) return;
      const wanted = control.getAttribute("data-haptic");
      if (wanted === "none") return;
      if (control.getAttribute("aria-disabled") === "true" || (control as HTMLButtonElement).disabled) {
        haptic("warning");
        return;
      }
      haptic(KINDS.includes(wanted as HapticKind) ? (wanted as HapticKind) : "selection");
    };
    // Capture: runs before a handler can stop the event, and before a route change
    // tears the control down.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);
  return null;
}
