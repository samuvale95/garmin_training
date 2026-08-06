"use client";

import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * False during the server render *and* during this component's own hydration render,
 * true from the pass right after it.
 *
 * Why any of this is needed: the persisted TanStack Query cache (providers.tsx) is
 * restored inside an effect at the root of the app. The root commits -- effects and all
 * -- before a route segment sitting behind a Suspense boundary (`(tabs)/loading.tsx`)
 * hydrates, so by the time a tab page runs its hydration render the cache already holds
 * last session's answers, while the server-rendered HTML that render has to match was
 * produced against an empty one. A screen that picks *what to render* from cached data
 * (skeleton vs. content) therefore has to stay on the server's answer for that one
 * render and switch a tick later, or React throws out the whole tree and rebuilds it.
 *
 * The flag has to be local to the component that hydrates late -- a shared,
 * provider-level one would already have flipped, for exactly the same reason the cache
 * has. Same external-store shape as `useMountOnce` in motion.ts: the server snapshot is
 * what hydration renders against, and React re-renders with the client one immediately
 * after.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}
