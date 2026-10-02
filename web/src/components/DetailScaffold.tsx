"use client";

import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";

/** The dark detail-screen frame, shared by `session/[id]` and `workout/[id]` (and their
 * `/strava` sub-screens).
 *
 * Two jobs. First, deduplication: both routes hand-repeated this container, the header
 * row and the delete-confirmation strip, with the copy as the only real difference.
 * Second -- and this is the point -- the frame renders *immediately*, before any data
 * arrives, so the transition into a detail screen lands on a page instead of on an empty
 * near-black viewport that reads as a broken app.
 */
export function DetailScaffold({
  backHref,
  caption,
  actions,
  confirm,
  error,
  children,
  footer,
  stickyBottom,
}: {
  backHref: string;
  /** Small mono line next to the back arrow (e.g. the date, or "dal calendario Garmin"). */
  caption?: ReactNode;
  /** Icon buttons on the right of the header row. */
  actions?: ReactNode;
  /** The delete-confirmation strip, when open. */
  confirm?: ReactNode;
  error?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  /** Primary action bar pinned to bottom of screen for zero-scroll thumb access */
  stickyBottom?: ReactNode;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--crema)",
        color: "var(--inchiostro)",
        padding: stickyBottom ? "24px 20px 96px" : "24px 20px 40px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480, margin: "0 auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <PageHeader backHref={backHref} color="var(--inchiostro)" />
            {caption && (
              <span className="font-mono" style={{ fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>
                {caption}
              </span>
            )}
          </div>
          {actions && <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "none" }}>{actions}</div>}
        </div>

        {confirm}

        {error && (
          <p style={{ color: "var(--rosso-avviso)", fontSize: 13, marginTop: 12 }} role="alert">
            {error}
          </p>
        )}

        {children}

        {footer}
      </div>

      {stickyBottom && (
        <div
          style={{
            position: "fixed",
            bottom: 0,
            left: 0,
            right: 0,
            background: "rgba(247, 244, 238, 0.92)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            borderTop: "1px solid var(--border-airbnb)",
            padding: "12px 20px calc(12px + env(safe-area-inset-bottom, 0px))",
            zIndex: 40,
            display: "flex",
            justifyContent: "center",
          }}
        >
          <div style={{ width: "100%", maxWidth: 480, display: "flex", gap: 10, alignItems: "center" }}>
            {stickyBottom}
          </div>
        </div>
      )}
    </div>
  );
}

/** The "are you sure" strip both detail screens show before deleting. */
export function DeleteConfirmStrip({
  message,
  isDeleting,
  onConfirm,
  onCancel,
}: {
  message: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        alignSelf: "stretch",
        background: "var(--rosa-avviso)",
        border: "1px solid rgba(224, 75, 59, 0.25)",
        borderRadius: "var(--radius-card)",
        padding: 14,
        marginTop: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <p style={{ fontSize: 13, color: "var(--rosso-testo)", fontWeight: 500, margin: 0, flex: 1 }}>{message}</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={isDeleting}
        className="tap-target"
        style={{
          background: "var(--rosso-forte)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--radius-pill)",
          padding: "8px 14px",
          fontSize: 12,
          fontWeight: 600,
          cursor: isDeleting ? "default" : "pointer",
        }}
      >
        {isDeleting ? "..." : "Elimina"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={isDeleting}
        className="tap-target"
        style={{ background: "none", border: "none", fontSize: 12, color: "var(--inchiostro-50)", cursor: "pointer" }}
      >
        Annulla
      </button>
    </div>
  );
}

/** The trash icon in a detail screen's header row. */
export function DeleteIconButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="tap-target"
      aria-label="Elimina allenamento"
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: "var(--sabbia-chip)",
        border: "1px solid var(--border-airbnb)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--rosso-forte)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
        transition: "all 0.15s ease",
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  );
}
