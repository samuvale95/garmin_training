## 1. Sticky week header

- [x] 1.1 In `web/src/app/(tabs)/week/page.tsx`, wrap the `BrandMark`, the ‹ range › selector row, and the `BarGrow` progress bar in a single container styled `position: "sticky", top: 0, zIndex: 1, background: "var(--crema)"`, matching the pattern in `web/src/app/diff/page.tsx` (lines ~38-45).
- [x] 1.2 Keep the day-card list and everything below the progress bar outside the sticky container so it scrolls normally underneath.
- [x] 1.3 Adjust padding on the sticky container vs. the remaining page content so spacing matches the current (non-sticky) layout — no visual shift when not scrolled.
- [x] 1.4 (found during implementation, not in original design) Fix `.app-shell` in `web/src/app/globals.css`: `overflow-x: hidden` was silently forcing `overflow-y: auto` per the CSS overflow spec's visible→auto coercion rule, turning `.app-shell` into an accidental scroll container that broke `position: sticky` for every descendant — including `TabBar`, which was drifting off-screen with page scroll instead of pinning to the viewport bottom. Changed to `overflow-x: clip` (excluded from that coercion rule), which fixes stickiness app-wide without any component-level changes. Verified via Playwright: `TabBar` and the new week header both now correctly stay pinned to the viewport through scroll.

## 2. Back/home control tap motion

- [x] 2.1 In `web/src/components/PageHeader.tsx`, add `onPointerDown`/`onPointerUp`/`onPointerLeave` handlers to the `Link` that scale it to `0.97` on press and back to `1` on release/leave, mirroring `PrimaryButton`'s press mechanics in `web/src/components/motion/primitives.tsx` (lines ~260-273).
- [x] 2.2 Add `transition: transform 120ms var(--ease)` (or the equivalent `DURATIONS.tap`-based value) to the `Link`'s style so the scale change is animated, not instant.
- [x] 2.3 Gate the press animation behind `useMotionEnabled()` from `web/src/lib/motion.ts`: when `reduced` is true, skip the pointer handlers/transition entirely so reduced-motion users see no scale effect but retain full tap functionality.
- [x] 2.4 Verify `backHref`/home-fallback navigation behavior is unchanged (no regression to routing logic).

## 3. Verification

- [x] 3.1 Run the web dev server; on `/week`, scroll the day list and confirm the brand mark, selector, and progress bar stay pinned to the top with no scrolled content showing through, and that ‹ / › paging still works while pinned. Verified with Playwright (headless Chromium, no `chromium-cli`/browser tooling available in this environment, so Playwright was installed ad hoc for the smoke test): `stickyTop` measured at `0` after scroll (was `-208`, fully off-screen, before the `.app-shell` fix); screenshots at `/tmp/week-top.png` / `/tmp/week-scrolled.png` show the header and `TabBar` both pinned while day cards scroll underneath; `›` paging changed the displayed range from "3 ago – 9 ago" to "10 ago – 16 ago" while scrolled.
- [x] 3.2 On at least one `PageHeader` screen (e.g. `/settings`, `/diff`), confirm the back/home control visibly scales down on press and returns to rest on release, and still navigates correctly. Verified on `/settings`: `transform` measured `none` at rest, `matrix(0.970732, 0, 0, 0.970732, 0, 0)` (scale ≈0.97) mid-press, and a full click correctly navigated to `/today`.
- [x] 3.3 Toggle "Meno movimento" (or emulate `prefers-reduced-motion: reduce`) and confirm the back/home control shows no press-scale animation but remains tappable. Verified via Playwright's `reducedMotion: "reduce"` context emulation: `transform` stayed `none` throughout the press.
- [x] 3.4 `npx tsc --noEmit` passes with no new errors. Confirmed clean (no output).
