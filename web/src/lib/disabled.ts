/** Props for a button that is disabled but must still receive the tap.
 *
 * A native `disabled` button emits no events (Safari/iOS often not even `pointerdown`), so
 * a tap on it is invisible to the interaction log -- and that is exactly the tap that says
 * "the user wanted this and was blocked". `aria-disabled` keeps the element alive; the
 * global click guard in `tracker.ts` swallows its click, so the user sees no difference.
 * `reason` is what the log records as to *why* they were blocked.
 *
 * Spread it on the element: `<button {...dis(isPending, "in_caricamento")}>`.
 */
export function dis(isDisabled: boolean | undefined, reason: string): { "aria-disabled"?: true; "data-disabled-reason"?: string } {
  return isDisabled ? { "aria-disabled": true, "data-disabled-reason": reason } : {};
}
