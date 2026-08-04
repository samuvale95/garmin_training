## Context

Two unrelated but small UI-consistency gaps exist in the Passo web app (`web/`, Next.js App Router + framer-motion):

1. `week/page.tsx` renders its brand mark, week date-selector (‹ range ›), and progress bar directly in the page's normal document flow (`padding: "22px 20px 12px"`, no positioning) inside the `(tabs)` layout, which scrolls at the window level. `diff/page.tsx` already solves the identical problem — a header block that should stay visible while a list scrolls beneath it — with `position: sticky, top: 0, zIndex: 1` plus an opaque `background` so scrolling content doesn't show through.
2. `PageHeader.tsx`, used as the back/home control on 11 non-tab screens, is a bare `next/link` with no interaction feedback. Every other tappable control in the app (`PrimaryButton` in `primitives.tsx`, `TabBar`'s active pill) provides feedback using one shared vocabulary: `EASE = [0.22, 1, 0.36, 1]` and the `DURATIONS` scale from `lib/motion.ts` (`tap: 120`, `release: 180`), gated by `useMotionEnabled()` for reduced-motion.

## Goals / Non-Goals

**Goals:**
- Week screen's date-selector + progress bar stay pinned to the viewport top while the day list scrolls, matching `diff`'s established sticky-header pattern.
- `PageHeader` back/home control gets tap press-feedback using the app's existing motion vocabulary (same easing/duration source as `PrimaryButton`), including reduced-motion support.

**Non-Goals:**
- No code change to `TabBar` itself (already `position: sticky, bottom: 0`) — though see the implementation note below, its *behavior* ends up corrected as a side effect of the root-cause CSS fix.
- No change to route-level transitions (`RouteTransition.tsx`) or entrance-cascade behavior.
- No redesign of `PageHeader`'s visual appearance (glyphs, color prop, sizing) beyond adding interaction motion.
- No new capability for the week-paging buttons' own animation beyond what already exists (`WordIn` on the date label).

## Decisions

- **Sticky wrapper, not `TabBar`-style fixed positioning**: reuse `position: sticky, top: 0, zIndex: 1` (the `diff/page.tsx` pattern) rather than `position: fixed`, so the week header behaves identically to every other sticky header in the app and doesn't need manual height offsetting for the content below it. Wrap `BrandMark` + the ‹ range › row + `BarGrow` in one sticky container with `background: var(--crema)` (matching `diff`'s opaque background) so the day-card list doesn't show through when scrolled under it.
- **Reuse `PrimaryButton`'s press mechanics, not a new primitive**: apply the same `onPointerDown/Up/Leave` scale-to-0.97 + `transition: transform 120ms var(--ease)` approach directly to `PageHeader`'s `Link`, rather than introducing a new motion primitive or pulling in `framer-motion`'s `whileTap` (which would be the only `motion.a`/`motion.create(Link)` usage in the file and adds an unnecessary dependency for a single-property transform). Gate it behind `useMotionEnabled()` exactly as `PrimaryButton` does, so "Meno movimento" and `prefers-reduced-motion` both suppress it.
- **No spec change to the existing `web-navigation` delta**: that capability (from the unarchived `add-page-back-navigation` change) governs *whether* a back control exists per screen. This change only adds interaction motion to the already-agreed-upon control, so it's modeled as two new, narrowly-scoped capabilities (`sticky-week-header`, `back-control-motion`) rather than reopening `web-navigation`.

## Implementation Note (found during apply, not anticipated at design time)

Wrapping the week header in `position: sticky, top: 0` per the decision above did not stick when first implemented — verification with Playwright showed it scrolling fully off-screen. Root cause: `.app-shell` (`web/src/app/globals.css`, the root wrapper rendered by `AppShell` around the whole app) declared `overflow-x: hidden` with no `overflow-y`. Per the CSS Overflow spec, when one axis is non-`visible`/non-`clip` and the other is `visible` (whether by default or explicit declaration), the UA forces the `visible` axis's *computed* value to `auto`. That silently turned `.app-shell` into a scroll container — one that never actually develops an internal scrollbar (it just grows past the viewport, so real scrolling still happens at the window level), which means any `position: sticky` descendant anchors to `.app-shell`'s permanently-`0` internal `scrollTop` instead of the real window scroll, and behaves as if `position: static`.

This affected every sticky element in the app, not just the new week header: `TabBar` (`position: sticky, bottom: 0`) was measurably drifting off-screen with page scroll rather than pinning to the viewport bottom — the exact bug the change was filed for, just at a different layer than assumed. The `diff/page.tsx` sticky header this design was modeled on was equally broken; it simply had never been scroll-tested.

Fix: changed `.app-shell`'s `overflow-x: hidden` to `overflow-x: clip` (one line, `web/src/app/globals.css`). `clip` is explicitly excluded from the visible→auto coercion rule, so it clips horizontal overflow without creating an accidental scroll container. This is a root-cause fix — no per-component changes were needed for `TabBar` to start working correctly. Re-verified with Playwright: week header pins at `top: 0` on scroll (was `-208`, i.e. fully off-screen); `TabBar` pins near the viewport bottom respecting its own `margin-bottom: 18px` (previously drifted the full scroll delta).

## Risks / Trade-offs

- [Sticky header + opaque background could visually clip content that scrolls close beneath it if `zIndex`/`background` are wrong] → mirror `diff/page.tsx` exactly (`zIndex: 1`, `background: var(--crema)`), which is already visually verified in the app.
- [Adding inline `onPointerDown/Up/Leave` handlers to a `next/link` changes it from a server-renderable-looking link to one needing client interactivity] → `PageHeader` and `week/page.tsx` are already `"use client"` (or contained within client components), so no new client-boundary is introduced.
- [Reduced-motion users get no back-button feedback at all] → acceptable and consistent: `PrimaryButton` has the identical trade-off today (no tap animation, no substitute) when `reduced` is true.

## Migration Plan

Straightforward code change, no data/schema/API involved. Ship behind normal review; no feature flag or staged rollout needed — visually verify both changes locally (`npm run dev`) on `/week` (scroll behavior) and any `PageHeader` screen (e.g. `/settings`, `/diff`) before merging.
