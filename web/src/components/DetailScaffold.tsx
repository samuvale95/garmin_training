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
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "var(--inchiostro)",
        color: "var(--crema)",
        padding: "24px 22px 32px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ alignSelf: "stretch", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <PageHeader backHref={backHref} color="var(--crema)" />
          {caption && (
            <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-su-scuro)" }}>
              {caption}
            </span>
          )}
        </div>
        {actions && <div style={{ display: "flex", alignItems: "center", gap: 14, flex: "none" }}>{actions}</div>}
      </div>

      {confirm}

      {error && (
        <p style={{ alignSelf: "stretch", color: "var(--rosso-avviso)", fontSize: 13, marginTop: 10 }} role="alert">
          {error}
        </p>
      )}

      {children}

      {footer}
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
        background: "rgba(246,238,218,.1)",
        borderRadius: "var(--radius-card)",
        padding: 14,
        marginTop: 14,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <p style={{ fontSize: 13, margin: 0, flex: 1 }}>{message}</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={isDeleting}
        className="tap-target"
        style={{
          background: "var(--rosso-forte)",
          color: "var(--crema)",
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
        style={{ background: "none", border: "none", fontSize: 12, color: "var(--inchiostro-su-scuro)", cursor: "pointer" }}
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
        background: "none",
        border: "none",
        fontSize: 18,
        color: "var(--rosso-avviso)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      🗑
    </button>
  );
}
