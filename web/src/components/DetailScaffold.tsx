"use client";

import { dis } from "@/lib/disabled";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";

/** The detail-screen frame, shared by `session/[id]` and `workout/[id]` (and their
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
    <div className="detail" data-sticky={stickyBottom ? true : undefined}>
      <div className="detail-head">
        <div className="detail-head-start">
          <PageHeader backHref={backHref} />
          {caption && <span className="detail-caption">{caption}</span>}
        </div>
        {actions && <div className="detail-actions">{actions}</div>}
      </div>

      {confirm}

      {error && (
        <p className="ux-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </p>
      )}

      {children}

      {footer}

      {stickyBottom && (
        <div className="detail-sticky">
          <div>{stickyBottom}</div>
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
    <div className="confirm-strip" role="alert">
      <p>{message}</p>
      <button data-track="detail-scaffold.onconfirm" type="button" onClick={onConfirm} {...dis(isDeleting, "in_caricamento")} className="btn" data-size="sm" data-variant="accent" style={{ background: "var(--danger)", borderColor: "var(--danger)" }}>
        {isDeleting ? "Elimino…" : "Elimina"}
      </button>
      <button data-track="detail-scaffold.oncancel" type="button" onClick={onCancel} {...dis(isDeleting, "in_caricamento")} className="btn" data-size="sm" data-variant="quiet">
        Annulla
      </button>
    </div>
  );
}

/** The trash icon in a detail screen's header row. */
export function DeleteIconButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button data-track="detail-scaffold.elimina-allenamento" type="button" onClick={onClick} {...dis(disabled, "non_disponibile")} className="icon-btn" aria-label="Elimina allenamento" style={{ color: "var(--danger)", opacity: disabled ? 0.5 : 1 }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  );
}
