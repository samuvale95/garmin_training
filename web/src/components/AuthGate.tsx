"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { useSession } from "@/lib/auth";

const LOGIN_PATH = "/login";

// Local-dev escape hatch, mirrors `DEV_AUTH_BYPASS_USER_ID` on the backend (see
// `api/auth.py`): with no Supabase project configured yet, there's no session to
// gate on, so skip straight to the app instead of stranding every screen behind
// a login button that can't work.
const DEV_BYPASS = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === "1";

/** Gates every route behind a Supabase session -- the backend now rejects every call
 * without one (see `api/app.py`'s auth-gated routers), so a signed-out visitor getting
 * as far as a screen full of failed requests would be a worse experience than never
 * letting them past `/login` at all.
 *
 * Mirrors the "wait for the first check before deciding" shape `app/page.tsx` already
 * uses for the Garmin-status check: `loading` and "definitely signed out" must render
 * differently, or a signed-in user flashes the login screen on every reload.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { session, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const onLoginPage = pathname === LOGIN_PATH;

  useEffect(() => {
    if (DEV_BYPASS || loading) return;
    if (!session && !onLoginPage) router.replace(LOGIN_PATH);
    if (session && onLoginPage) router.replace("/");
  }, [loading, session, onLoginPage, router]);

  if (DEV_BYPASS) return <>{children}</>;

  const decided = !loading && (session ? !onLoginPage : onLoginPage);
  if (!decided) {
    return (
      <div style={{ padding: "30px 22px 0", minHeight: "100dvh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark height={26} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>Passo</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
