"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, isPrimaryActive } from "@/lib/navigation";
import { markTabMethod } from "@/lib/tracker";

export function TabBar() {
  const pathname = usePathname();
  return <nav className="primary-nav" aria-label="Navigazione principale">
    <span className="primary-nav-brand">Passo<span>Il tuo allenamento, ogni giorno.</span></span>
    <div className="primary-nav-items">{PRIMARY_NAV.map(({ href, label, icon }) =>
      <Link key={href} href={href} className="primary-nav-link" aria-current={isPrimaryActive(pathname, href) ? "page" : undefined} data-track={`tabbar.${href.slice(1)}`} onClick={() => markTabMethod("tap")}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={icon} /></svg>
        <span>{label}</span>
      </Link>
    )}</div>
    <Link className="primary-nav-profile" href="/settings" data-track="sidebar.profile">Profilo e connessioni</Link>
  </nav>;
}
