"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePassoStore } from "./store";

/** MOTION.md §1.2 -- canonical durations, in ms. */
export const DURATIONS = {
  tap: 120,
  release: 180,
  element: 450,
  row: 600,
  screen: 700,
  bar: 900,
  landing: 1000,
  fill: 1300,
  stagger: 80,
} as const;

function subscribeToReducedMotion(callback: () => void): () => void {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

// useSyncExternalStore, not useState+useEffect: this reads a genuine external
// system (the media query) and reacting to it is exactly what the hook is for --
// it also sidesteps the "setState synchronously in an effect" pitfall a
// state+effect version would hit.
function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToReducedMotion, getReducedMotionSnapshot, getReducedMotionServerSnapshot);
}

/**
 * Combines system `prefers-reduced-motion`, the in-app "Meno movimento" toggle, and an
 * optional per-screen "still zone" override (screens 04/05/14) into one signal -- per
 * design.md decision #5, all three collapse to the same reduced-motion behavior.
 */
export function useMotionEnabled(stillZone = false): { reduced: boolean } {
  const systemReduced = usePrefersReducedMotion();
  const menoMovimento = usePassoStore((s) => s.prefs.menoMovimento);
  return { reduced: stillZone || systemReduced || menoMovimento };
}

const noopSubscribe = () => () => {};

/**
 * Fluid entrance animation signal for page opens.
 * Returns true unless reduced motion is active, ensuring every page open and tab switch
 * cascades in with silky-smooth spring physics.
 */
export function useMountOnce(_key?: string): boolean {
  const { reduced } = useMotionEnabled();
  return !reduced;
}

export function staggerDelay(index: number, baseMs = 0, stepMs: number = DURATIONS.stagger): string {
  return `${baseMs + index * stepMs}ms`;
}
