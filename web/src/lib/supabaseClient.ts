import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Warn, don't throw: `createClient` runs at module load, which includes Next.js's
// static prerender of pages like `/_not-found` that never touch auth at all -- a hard
// throw here would fail the production build itself over a misconfigured dev machine.
// Left unset, every real auth call below fails with a clear network/config error
// instead, the same "degrade, don't crash the app" rule `llm.py` applies server-side.
if (!url || !anonKey) {
  console.warn(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set (see web/.env.local) -- sign-in will not work."
  );
}

/** One client for the whole app, same pattern as `apiClient.ts`'s module-level
 * `API_BASE_URL` -- this is a plain client-side SPA (no server components read auth
 * state), so the default `localStorage`-backed session is enough; no `@supabase/ssr`
 * cookie plumbing needed. */
export const supabase = createClient(url || "https://placeholder.supabase.co", anonKey || "placeholder-anon-key");
