"use client";

import { usePassoStore } from "./store";

/** Tactile feedback, on both platforms.
 *
 * Android has `navigator.vibrate`. iOS Safari has never had it -- every `vibrate()` call
 * the app made was silent on an iPhone -- but since iOS 17.4 toggling a native
 * `<input type="checkbox" switch>` plays the system's own selection haptic, and it does
 * so from a script click as long as the click happens inside a user gesture. So on iOS
 * a hidden switch is clicked; everywhere else the vibration motor runs a short pattern.
 *
 * The kinds follow Apple's vocabulary, which is what "feels premium" means in practice:
 * a crisp tick for a selection, a slightly heavier one for an impact, a double tap for
 * success, a triple for an error. Nothing longer than ~60 ms, nothing on scroll.
 */
export type HapticKind = "selection" | "light" | "medium" | "heavy" | "success" | "warning" | "error";

const VIBRATION: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 16,
  heavy: 26,
  success: [12, 60, 18],
  warning: [20, 80, 20],
  error: [24, 50, 24, 50, 24],
};

// iOS plays one tick per toggle; a "pattern" is ticks spaced in time.
const IOS_TICKS: Record<HapticKind, number[]> = {
  selection: [0],
  light: [0],
  medium: [0],
  heavy: [0, 40],
  success: [0, 90],
  warning: [0, 110],
  error: [0, 80, 160],
};

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** One system haptic: a switch toggled through its label, never shown. Built and
 * removed each time -- WebKit only plays it for a freshly clicked label. */
let ticking = false;

function iosTick() {
  if (ticking) return;
  ticking = true;
  try {
    clickHiddenSwitch();
  } finally {
    ticking = false;
  }
}

function clickHiddenSwitch() {
  const label = document.createElement("label");
  label.setAttribute("aria-hidden", "true");
  label.style.display = "none";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("switch", "");
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
}

function enabled(): boolean {
  try {
    return usePassoStore.getState().prefs.vibrazioni !== false;
  } catch {
    return true;
  }
}

/** Play a haptic. Call it from inside the tap/gesture handler that caused it: iOS only
 * honours the hidden switch during a user gesture. */
export function haptic(kind: HapticKind = "selection") {
  if (typeof window === "undefined" || !enabled()) return;
  if (isIOS()) {
    for (const delay of IOS_TICKS[kind]) {
      if (delay === 0) iosTick();
      else window.setTimeout(iosTick, delay);
    }
    return;
  }
  if (typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(VIBRATION[kind]);
    } catch {
      /* some browsers throw outside a gesture: nothing to do */
    }
  }
}
