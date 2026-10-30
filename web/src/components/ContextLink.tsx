"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { safeReturnHref, withReturnTo } from "@/lib/navigation";

export const RETURN_HISTORY_KEY = "passo.return-history";

export function ContextLink({ href, from, onClick, ...props }: Omit<ComponentProps<typeof Link>, "href"> & { href: string; from: string }) {
  const target = withReturnTo(href, from);
  return <Link {...props} href={target} onClick={(event) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    try {
      sessionStorage.setItem(RETURN_HISTORY_KEY, JSON.stringify({ from: `${location.pathname}${location.search}`, returnTo: safeReturnHref(from), to: target, length: history.length }));
    } catch { /* Navigation still works when browser storage is unavailable. */ }
  }} />;
}
