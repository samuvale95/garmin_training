## Why

Several screens in the Passo web app (settings, import, connect-garmin, diff, confirm-deletions, sync, sync/result, rate-limit, session detail, body/conflict, body/load) render no way to leave the page other than the browser's own back button. Only the three tab pages (today/week/body) have navigation, via `TabBar`. A user who lands on one of the un-tabbed screens — including through a deep link, a redirect (e.g. rate-limit), or after a completed action (e.g. sync result) — has no in-app affordance to return to a previous step or to home, and can feel stuck inside the flow.

## What Changes

- Add a reusable `PageHeader` (or equivalent) navigation component that renders a back control (and, where there is no meaningful "back", a home control) at the top of a page.
- Wire every route under `src/app` that is not already reachable via `TabBar` to use this component: `settings`, `diff`, `connect-garmin`, `confirm-deletions`, `sync`, `sync/result`, `import`, `rate-limit`, `session/[id]`, `(tabs)/body/conflict`, `(tabs)/body/load`.
- Back navigation prefers in-flow `router.back()` / an explicit prior step (e.g. diff → import, confirm-deletions → diff), and falls back to a home link (`/today`) when there is no sensible previous step (e.g. deep-linked or terminal screens like `rate-limit`, `sync/result`).
- Replace the ad-hoc "Indietro" button in `session/[id]`'s not-found branch with the shared component for consistency.
- **BREAKING**: none — this is additive UI; no existing routes, APIs, or stored data change shape.

## Capabilities

### New Capabilities
- `web-navigation`: every app screen exposes a consistent way to go back to the previous step or to the home tab, so users are never stuck without an exit.

### Modified Capabilities
(none — no existing spec covers this behavior yet)

## Impact

- Affected code: `web/src/app/**/page.tsx` for the listed routes, a new shared component under `web/src/components/` (e.g. `PageHeader.tsx`), no backend/API changes.
- No new dependencies. No data migrations. Visual/layout impact only on the listed pages.
