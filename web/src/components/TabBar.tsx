"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PRIMARY_NAV, isPrimaryActive } from "@/lib/navigation";
import { markTabMethod } from "@/lib/tracker";

/** The five destinations, always in the same order. Rendered twice by the frame -- the
 * bottom bar on phones, the sidebar from 1024px -- and CSS shows one of the two. */
export function TabBar({ placement }: { placement: "bottom" | "side" }) {
  const pathname = usePathname();
  return (
    <ul>
      {PRIMARY_NAV.map(({ href, label, icon }) => (
        <li key={href}>
          <Link
            href={href}
            className="nav-link"
            aria-current={isPrimaryActive(pathname, href) ? "page" : undefined}
            data-track={`${placement === "bottom" ? "tabbar" : "sidebar"}.${href.slice(1)}`}
            onClick={() => markTabMethod("tap")}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={icon} />
            </svg>
            <span className="nav-link-label">{label}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
