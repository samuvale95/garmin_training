## 1. Shared component

- [x] 1.1 Create `web/src/components/PageHeader.tsx`: accepts `backHref?: string`, and renders a back link when provided, otherwise a home link to `/today`. Built on `next/link` (no imperative `onBack`/`router.push` needed since every target is a static route). Takes a `color` prop so it reads on both light and dark/colored full-bleed backgrounds.
- [x] 1.2 Give the control a `tap-target` class and an `aria-label` ("Indietro" / "Torna alla home") for accessibility, matching the pattern already used by `TabBar`.

## 2. Wire pages with a well-defined predecessor

- [x] 2.1 `diff/page.tsx`: add `PageHeader` with `backHref="/import"`.
- [x] 2.2 `confirm-deletions/page.tsx`: add `PageHeader backHref="/diff"` to the header row. Kept the existing full-width "Annulla" button as-is rather than replacing it — on this destructive-action confirmation screen it functions as a primary decision control (paired with "Cancella e ricrea"), not generic nav chrome, so collapsing it into a small header icon would have reduced its visibility for exactly the action where hesitation matters most. The header icon now provides the same immediate escape hatch as every other page, in addition to the existing button.
- [x] 2.3 `session/[id]/page.tsx`: add `PageHeader backHref="/week"` to the main render path, and replace the ad-hoc "Indietro" button in the not-found branch with the same component.
- [x] 2.4 `(tabs)/body/conflict/page.tsx`: add `PageHeader backHref="/body"` (kept the existing "skip" `router.push("/today")` action separate from this nav control).
- [x] 2.5 `(tabs)/body/load/page.tsx`: add `PageHeader backHref="/body"`.

## 3. Wire pages that fall back to home

- [x] 3.1 `settings/page.tsx`: add `PageHeader` with no `backHref` (renders home link to `/today`).
- [x] 3.2 `connect-garmin/page.tsx`: add `PageHeader` with no `backHref` (multiple entry points: onboarding root and settings).
- [x] 3.3 `import/page.tsx`: add `PageHeader` with no `backHref` (multiple entry points: today, week, connect-garmin).
- [x] 3.4 `sync/page.tsx`: add `PageHeader` with no `backHref` in both the "no job" and in-progress render paths, styled for the dark full-bleed background; does not interfere with the existing cancel button.
- [x] 3.5 `sync/result/page.tsx`: add `PageHeader` with no `backHref`, in both the "no result" fallback and the main render path (keep the existing "Guarda la settimana" button as a separate primary action).
- [x] 3.6 `rate-limit/page.tsx`: add `PageHeader` with no `backHref`, styled for its full-bleed background.

## 4. Verification

- [x] 4.1 Ran the web dev server and hit each of the 11 affected routes; all return 200 and render the expected `aria-label="Indietro"` / `aria-label="Torna alla home"` control. `diff` and `session/[id]` correctly redirect to `/import` when no plan is loaded (pre-existing `useRequirePlan` guard, unrelated to this change) — verified the guard, not a regression.
- [x] 4.2 Confirmed `(tabs)` routes (`today`, `week`, `body`) and `TabBar.tsx` have no diff — unchanged, still rely solely on `TabBar`.
- [x] 4.3 `npx tsc --noEmit` passes with no errors. `npm run lint` has 3 pre-existing `no-require-imports` errors in `scripts/dev-qr.js`, unrelated to this change (not touched).
