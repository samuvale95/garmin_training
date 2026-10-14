"use client";

import { useState, useSyncExternalStore } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { BellIcon, CloseIcon } from "@/components/Icons";
import { dis } from "@/lib/disabled";
import { enablePush, isStandalone, usePushState } from "@/lib/push";

const DISMISS_KEY = "passo-push-nudge-dismissed";

const noSubscription = () => () => {};

function eligibleNow(): boolean {
  let dismissed = false;
  try {
    dismissed = localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    /* storage unavailable: ask anyway */
  }
  return !dismissed && isStandalone();
}

/** Once the app is installed, the one question it should ask: may I remind you? Shown on
 * Oggi only while the answer is still open, and only in the installed app -- in a browser
 * tab the install banner comes first. Dismissed for good with the ✕. */
export function PushNudge() {
  const { state, setState } = usePushState();
  // Read once on the client; the server render (and the first client one) says no.
  const eligible = useSyncExternalStore(noSubscription, eligibleNow, () => false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const visible = eligible && !dismissed;

  if (!visible || state !== "off") return null;

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to remember it in */
    }
  }

  async function enable() {
    setBusy(true);
    try {
      setState(await enablePush());
    } catch {
      /* the settings screen explains what went wrong */
    } finally {
      setBusy(false);
    }
  }

  return (
    <SlideUp
      active
      delayMs={120}
      style={{
        marginTop: 14,
        background: "var(--inchiostro)",
        color: "var(--crema)",
        borderRadius: "var(--radius-card)",
        padding: "14px 14px 14px 16px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "var(--shadow-airbnb-card)",
      }}
    >
      <span aria-hidden="true" style={{ width: 34, height: 34, flex: "none", borderRadius: "50%", background: "rgba(255,255,255,0.12)", display: "grid", placeItems: "center", color: "var(--corallo)" }}>
        <BellIcon size={16} strokeWidth={2.2} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>Ti ricordo pasti e acqua?</p>
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-su-scuro)", margin: "2px 0 0", lineHeight: 1.35 }}>All&apos;ora giusta, anche ad app chiusa.</p>
      </div>
      <button
        type="button"
        data-track="push-nudge.enable"
        data-haptic="success"
        onClick={enable}
        {...dis(busy, "in_caricamento")}
        style={{ background: "var(--corallo-accent)", color: "#fff", border: "none", borderRadius: 12, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", flex: "none" }}
      >
        {busy ? "…" : "Attiva"}
      </button>
      <button
        type="button"
        data-track="push-nudge.dismiss"
        onClick={dismiss}
        aria-label="Non ora"
        style={{ background: "transparent", border: "none", color: "var(--inchiostro-su-scuro)", padding: 4, cursor: "pointer", display: "flex", flex: "none" }}
      >
        <CloseIcon size={16} />
      </button>
    </SlideUp>
  );
}
