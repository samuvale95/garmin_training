## Why

Two small inconsistencies stand out against the motion and layout patterns already established elsewhere in the Passo web app: the week screen's date-selector bar scrolls away with the day list instead of staying pinned like the equivalent header on `diff`, and the back/home control (`PageHeader`, added across 11 screens) is a plain, unanimated link even though every other interactive control in the app (buttons, tab pills, route transitions) has tap feedback built on the same easing curve and duration scale.

## What Changes

- Make the week screen's date-range selector (prev/next week arrows) and its progress bar stick to the top of the viewport while the day list beneath it scrolls, using the same `position: sticky, top: 0` pattern already used by `diff/page.tsx`.
- Add press/tap feedback motion to `PageHeader`'s back and home control, reusing the app's established interaction pattern (`EASE = [0.22, 1, 0.36, 1]`, `DURATIONS.tap`/`DURATIONS.release`) as already applied to `PrimaryButton`, and respecting the existing reduced-motion toggle (`useMotionEnabled`).
- No change to `TabBar` — it is already `position: sticky, bottom: 0` and out of scope.
- **BREAKING**: none — visual/interaction polish only, no route, API, or data changes.

## Capabilities

### New Capabilities
- `sticky-week-header`: the week screen's date-selector and progress bar remain visible at the top of the viewport while the day list scrolls beneath them.
- `back-control-motion`: the back/home navigation control provides tap press-feedback motion consistent with the app's established interaction pattern, and respects reduced-motion preferences.

### Modified Capabilities
(none — `openspec/specs/` has no synced capabilities yet; `web-navigation`, added by the unarchived `add-page-back-navigation` change, covers the *existence* of the back control, not its motion, so it is extended via a new capability rather than modified)

## Impact

- Affected code: `web/src/app/(tabs)/week/page.tsx` (sticky header), `web/src/components/PageHeader.tsx` (tap motion), `web/src/app/globals.css` (`.app-shell` overflow fix — see design.md's implementation note), reusing existing helpers from `web/src/lib/motion.ts` and patterns from `web/src/components/motion/primitives.tsx`.
- The `globals.css` fix is app-wide: it also corrects `TabBar`'s existing `position: sticky, bottom: 0`, which was silently broken by the same root cause (drifting off-screen with page scroll instead of pinning to the viewport bottom) despite no `TabBar` code changes.
- No new dependencies (framer-motion and the existing motion primitives already cover this). No data or API changes. Visual/interaction impact only.
