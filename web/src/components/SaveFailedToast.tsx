"use client";

import { useEffect, useState } from "react";
import { SAVE_FAILED_EVENT } from "@/lib/queries";

/** App-wide: a change the server did not accept is said, on whatever screen it happened. */
export function SaveFailedToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let timer = 0;
    const onFail = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), 8_000);
    };
    window.addEventListener(SAVE_FAILED_EVENT, onFail);
    return () => {
      window.removeEventListener(SAVE_FAILED_EVENT, onFail);
      window.clearTimeout(timer);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)",
        zIndex: 70,
        background: "var(--rosso-forte)",
        color: "#fff",
        borderRadius: "var(--radius-card)",
        padding: "12px 14px",
        fontSize: 13.5,
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 12,
        boxShadow: "var(--shadow-airbnb-floating)",
      }}
    >
      <span style={{ flex: 1 }}>La modifica non è stata salvata. Controlla la connessione e riprova.</span>
      <button
        type="button"
        data-track="app.save-failed-dismiss"
        onClick={() => setVisible(false)}
        style={{ all: "unset", cursor: "pointer", textDecoration: "underline" }}
      >
        Ok
      </button>
    </div>
  );
}
