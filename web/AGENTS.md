<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Interaction tracking: rules for every screen

The app logs how it is used (`src/lib/tracker.ts`) to find where users get stuck. A new
screen or component is only measured correctly if it follows these rules:

- **Every new `page.tsx` calls `useScreenReady(condition)`** (`src/lib/useScreenReady.ts`)
  before any early `return`. `condition` is true once the screen shows something final:
  its data, an empty state or an error. A screen that is final from the first paint
  (a form, a redirect) calls `useScreenReady(true)`. A view mounted outside its own route
  (the tab pager keeps all four tabs mounted) passes its route: `useScreenReady(ready, "/today")`.
  Without it, load time falls back to a skeleton heuristic (`method: "heuristic"` in
  `screen_ready`) that cannot see blank screens.
- **Disabled or busy buttons use `{...dis(isDisabled, "reason")}`** (`src/lib/disabled.ts`),
  never the native `disabled` attribute: a tap on a native disabled button is invisible
  to the log. Use the reason `"in_caricamento"` while waiting on a request, so long waits
  are reported as `long_loading`.
- **Error messages shown to the user carry `role="alert"`**, so they are logged as
  `error_shown`.
- **Loading placeholders use the shared `Skeleton`** (`src/components/motion/primitives.tsx`)
  or the `anim-clay-shimmer` / `anim-sheen` classes.
- **Tappable elements get a `data-track="screen.element"` name**, otherwise the log falls
  back to the element's visible text.
