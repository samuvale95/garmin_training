## Context

Passo's web app is a Next.js App Router PWA-style flow (`web/src/app`). Root layout renders `AppShell` → `RouteTransition` → page content; the `(tabs)` route group additionally renders `TabBar` below its children, giving `today`, `week`, and `body` a persistent way to move around. Every other route (`settings`, `diff`, `connect-garmin`, `confirm-deletions`, `sync`, `sync/result`, `import`, `rate-limit`, `session/[id]`, and the nested tab routes `body/conflict`, `body/load`) is reached via `router.push` from elsewhere in the flow and renders no shared chrome — each page hand-rolls its own top-of-page markup (usually just a `BrandMark`). `session/[id]` is the only place with a back affordance, and only in its not-found branch. There is no `AppBar`/`PageHeader` primitive today.

## Goals / Non-Goals

**Goals:**
- Every route the user can land on has a visible, reachable way to go back one step or to jump to home (`/today`), with no dead ends.
- One shared component decides go-back vs go-home per page, so the rule lives in one place instead of being re-implemented per page.
- Minimal visual disruption: the component adopts each page's existing top-of-page spacing/branding rather than imposing a new global app bar.

**Non-Goals:**
- Not building a generic breadcrumb or multi-level nav history stack — one level of "back" is enough for this app's linear flows.
- Not changing the `TabBar` or tab routes' navigation model.
- Not adding new routes or changing the sync/import flow's business logic.

## Decisions

- **Shared `PageHeader` component, composed per page, not injected via layout.** The non-tab routes don't share a common layout segment (they're siblings directly under `src/app`), and several already render a `BrandMark` with page-specific spacing. Adding one `PageHeader` component that each page imports and calls with explicit props (`onBack`, `backHref`, `label`) is simpler than introducing a new shared layout segment and keeps each page's control over its own header markup. Alternative considered: a route-group layout (e.g. wrapping all non-tab routes in a new `(flow)` group) — rejected because the routes have too much per-page layout variance (e.g. `rate-limit` and `confirm-deletions` use full-bleed colored backgrounds) to share one layout wrapper cleanly.
- **Back target is decided per page via an explicit prop, not by sniffing `document.referrer` or router history.** Next.js App Router doesn't expose reliable history depth, and `router.back()` can leave the app entirely if the page was deep-linked (e.g. `rate-limit`, `sync/result` after a page reload). Each page passes either `backHref="/previous-step"` (known predecessor: `diff` ← `import`, `confirm-deletions` ← `diff`, `session/[id]` ← plan view) or omits it, in which case `PageHeader` renders a home link to `/today` instead. This makes the fallback explicit and testable rather than relying on runtime history state.
- **Home fallback target is always `/today`**, matching `TabBar`'s default/first tab, so "go home" has one unambiguous destination across the app.
- **`PageHeader` renders inline in the page's existing top padding**, not as a `position: sticky` bar, to match the current single-scroll, no-persistent-chrome feel of these screens (as opposed to `TabBar`, which is intentionally sticky).

## Risks / Trade-offs

- [Per-page `backHref` wiring can drift out of sync if a flow's ordering changes later] → Mitigation: keep the `backHref` values colocated with each page's own navigation calls (`router.push` targets), so a future flow change touches both in the same file.
- [Adding a header to pages with tight custom layouts (`rate-limit`, `confirm-deletions` full-bleed colored screens) could clash visually] → Mitigation: `PageHeader` accepts a `variant`/`color` prop (or inherits `currentColor`) so it can render legibly on both light and colored backgrounds; verify visually on each affected page before calling the task done.
- [Scope creep into a full app-bar redesign] → Mitigation: keep `PageHeader` deliberately minimal (icon + optional label) and out of the `TabBar` routes, which already have navigation.

## Open Questions

None — behavior is fully specified by the "prefer explicit back target, else home" rule above.
