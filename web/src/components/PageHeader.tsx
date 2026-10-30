"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { safeReturnHref } from "@/lib/navigation";
import { RETURN_HISTORY_KEY } from "@/components/ContextLink";

interface PageHeaderProps { backHref?: string; color?: string }

function BackLink({ backHref, color = "var(--inchiostro)", contextual = false }: PageHeaderProps & { contextual?: boolean }) {
  const router = useRouter();
  const href = backHref ?? "/today";
  void color;
  return <Link href={href} className="page-back" aria-label={backHref ? "Indietro" : "Torna a Oggi"} data-track="page-header.back" onClick={(event) => {
    if (!contextual || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    try {
      const record = JSON.parse(sessionStorage.getItem(RETURN_HISTORY_KEY) ?? "null");
      if (record?.to === `${location.pathname}${location.search}` && safeReturnHref(record.returnTo, "") === href && safeReturnHref(record.from, "") && history.length > record.length) {
        event.preventDefault();
        router.back();
      }
    } catch { /* Direct links retain the safe fallback. */ }
  }}>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7" /></svg>
    <span>{backHref ? "Indietro" : "Oggi"}</span>
  </Link>;
}

function ContextualHeader(props: PageHeaderProps) {
  const params = useSearchParams();
  const from = safeReturnHref(params.get("from"), "");
  return <BackLink {...props} backHref={from || props.backHref} contextual={!!from} />;
}

export function PageHeader(props: PageHeaderProps) {
  return <Suspense fallback={<BackLink {...props} />}><ContextualHeader {...props} /></Suspense>;
}
