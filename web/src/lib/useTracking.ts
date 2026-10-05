"use client";

import { useEffect, useRef } from "react";
import { lastTarget, track } from "./tracker";

/** `modal_open` / `modal_close` for a sheet or dialog. How it closed is the last thing the
 * user pressed (an X, a backdrop, a swipe leaves the previous target). */
export function useModalTracking(name: string, isOpen: boolean): void {
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen && !wasOpen.current) track("modal_open", name);
    else if (!isOpen && wasOpen.current) track("modal_close", name, { closed_by: lastTarget() });
    wasOpen.current = isOpen;
  }, [name, isOpen]);
}

const completed = new Set<string>();

/** Call when a flow reached its goal (a meal saved), just before it returns to idle. */
export function markFlowComplete(name: string): void {
  completed.add(name);
}

/** `flow_start` / `flow_step` / `flow_complete` / `flow_abandon` for a multi-step flow
 * driven by a state machine: leaving `idleStep` starts it, every change is a step, and
 * coming back to idle is a completion if `markFlowComplete` was called, else an abandon. */
export function useFlowTracking(name: string, step: string, idleStep = "idle"): void {
  const previous = useRef(step);
  const lastStep = useRef<string | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = step;
    if (before === step) return;
    if (before === idleStep) {
      track("flow_start", name, { step });
      lastStep.current = step;
    } else if (step === idleStep) {
      if (completed.delete(name)) track("flow_complete", name, { step: before });
      else track("flow_abandon", name, { step: before });
      lastStep.current = null;
    } else {
      track("flow_step", name, { step, from: before });
      lastStep.current = step;
    }
  }, [name, step, idleStep]);
}
