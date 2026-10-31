"use client";

import { useEffect, useState } from "react";
import { wakeServer } from "@/lib/apiClient";

// Below this a wake-up is just a normal answer and showing anything would flicker.
const SHOW_AFTER_MS = 2_500;

/** A thin note while the server is waking up, so a cold start reads as "one moment"
 * instead of as a broken app. Data cached on the phone keeps showing underneath. */
export function ServerWaking() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    let done = false;
    const timer = window.setTimeout(() => {
      if (!done) setWaking(true);
    }, SHOW_AFTER_MS);
    void wakeServer().finally(() => {
      done = true;
      window.clearTimeout(timer);
      setWaking(false);
    });
    return () => window.clearTimeout(timer);
  }, []);

  if (!waking) return null;
  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "calc(env(safe-area-inset-top, 0px) + 8px)",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 60,
        background: "var(--inchiostro)",
        color: "var(--crema)",
        borderRadius: "var(--radius-pill)",
        padding: "7px 14px",
        fontSize: 12.5,
        fontWeight: 600,
        boxShadow: "var(--shadow-airbnb-floating)",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span className="anim-clay-shimmer" aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "var(--verde)" }} />
      Il server si sta svegliando, un momento…
    </div>
  );
}
