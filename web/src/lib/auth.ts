"use client";

import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { supabase } from "./supabaseClient";

export interface SessionState {
  session: Session | null;
  /** True until the first `getSession()` resolves -- before that, "no session" and
   * "haven't checked yet" look identical and must not be treated the same (same
   * distinction `usePlanQuery`'s `isHydrated` draws for localStorage). */
  loading: boolean;
}

/** The current Supabase session, kept live via `onAuthStateChange` (fires on sign-in,
 * sign-out, and token refresh) so every component reading it re-renders together --
 * no separate polling, no risk of one screen believing a stale answer. */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    const devToken = typeof window !== "undefined" ? localStorage.getItem("passo_dev_token") : null;
    if (devToken) {
      const mockSession = {
        access_token: devToken,
        user: { id: "dev-athlete", email: "dev@passo.app" },
      } as unknown as Session;
      setState({ session: mockSession, loading: false });
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false });
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  return state;
}

/** The bearer token for the current Supabase session, or `null` when signed out --
 * read by `apiClient.ts` on every request. */
export async function getAccessToken(): Promise<string | null> {
  if (typeof window !== "undefined") {
    const devToken = localStorage.getItem("passo_dev_token");
    if (devToken) return devToken;
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export function signInDev(): void {
  if (typeof window !== "undefined") {
    localStorage.setItem("passo_dev_token", "dev-athlete");
    window.location.href = "/today";
  }
}

export async function signInWithGoogle(): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: window.location.origin },
  });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.removeItem("passo_dev_token");
  }
  await supabase.auth.signOut();
}
