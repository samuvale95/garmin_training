"use client";

import { QueryClient, type Query } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import { useState } from "react";

/** Every answer this app shows comes from Garmin or Strava over the network, and none
 * of it changes second to second: a calendar only changes when this app writes to it,
 * and overnight wellness figures are computed once a day. So cached data is shown
 * immediately and revalidated behind the scenes (`refetchOnMount` stays at its default
 * `true`, which does exactly that when data is already present).
 *
 * `retry: 0` on purpose: a failing Garmin call is slow, and one automatic retry only
 * doubled the time the user stared at nothing before seeing the error.
 */
const STALE_TIME = 5 * 60_000;
const GC_TIME = 24 * 60 * 60_000;

/** Bump to discard every persisted cache after a shape change to the stored data. */
const PERSIST_BUSTER = "passo-v1";

/** Query keys whose cached value must never be restored from a previous page load:
 * the plan keeps its own localStorage mirror (see `usePlanQuery`, which must stay the
 * single writer), and a sync job's progress belongs to the process that ran it. */
const VOLATILE_KEYS = ["plan-state", "sync-job"];

function isPersistable(query: Query): boolean {
  return !VOLATILE_KEYS.includes(String(query.queryKey[0]));
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: STALE_TIME,
            gcTime: GC_TIME,
            retry: 0,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Persisting to localStorage is what makes a reload (or reopening the installed PWA)
  // paint real data instead of an empty screen: the cache is restored asynchronously
  // after mount, so it can't cause a hydration mismatch the way reading storage during
  // the first render would.
  const [persistOptions] = useState(() => ({
    persister: createSyncStoragePersister({
      storage: typeof window === "undefined" ? undefined : window.localStorage,
      key: "passo-query-cache",
    }),
    maxAge: GC_TIME,
    buster: PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: isPersistable },
  }));

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </PersistQueryClientProvider>
  );
}
