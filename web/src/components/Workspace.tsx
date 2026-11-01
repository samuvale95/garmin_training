"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { Avatar } from "@/components/Avatar";
import { TabBar } from "@/components/TabBar";
import { isPrimaryRoute } from "@/lib/navigation";

/** The frame every in-app screen sits in. Phones get a top bar (brand, profile) and a
 * bottom bar on the five destinations; details and flows drop both and rely on their own
 * back link, so their sticky actions never fight the navigation for the thumb. From
 * 1024px the sidebar replaces both, on every screen, so the place of each function never
 * moves. */
export function Workspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const primary = isPrimaryRoute(pathname);
  const onProfile = pathname === "/settings" || pathname.startsWith("/settings/") || pathname === "/shoes";
  return (
    <div className="frame" data-bottombar={primary || undefined}>
      <a href="#contenuto" className="skip-link">Vai al contenuto</a>

      <nav className="sidebar" aria-label="Navigazione principale">
        <Link href="/today" className="topbar-brand" data-track="sidebar.home">
          <BrandMark height={22} forceStatic />
          <span>Passo</span>
        </Link>
        <TabBar placement="side" />
        <div className="sidebar-foot">
          <Link href="/settings" className="profile-link" aria-current={onProfile ? "page" : undefined} data-track="sidebar.profile">
            <Avatar size={30} />
            <span>Profilo e connessioni</span>
          </Link>
        </div>
      </nav>

      <div className="frame-body">
        {primary && (
          <header className="topbar">
            <Link href="/today" className="topbar-brand" aria-label="Passo, vai a Oggi" data-track="workspace.home">
              <BrandMark height={20} forceStatic />
              <span aria-hidden="true">Passo</span>
            </Link>
            <Link href="/settings" className="profile-link" aria-current={onProfile ? "page" : undefined} data-track="workspace.profile">
              <span>Profilo</span>
              <Avatar size={32} />
            </Link>
          </header>
        )}
        <main id="contenuto" className="frame-main" data-kind={primary ? "primary" : "detail"} tabIndex={-1}>
          {children}
        </main>
      </div>

      {primary && (
        <nav className="bottombar" aria-label="Navigazione principale">
          <TabBar placement="bottom" />
        </nav>
      )}
    </div>
  );
}

const PLAN_SECTIONS = [
  ["/week", "Calendario"],
  ["/week/programs", "Programmi"],
  ["/week/goals", "Obiettivi"],
] as const;

/** Calendario · Programmi · Obiettivi: the three stable parts of Piano. */
export function PlanNavigation() {
  const pathname = usePathname();
  return (
    <nav className="subnav" aria-label="Sezioni del piano">
      {PLAN_SECTIONS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href || (href !== "/week" && pathname.startsWith(`${href}/`)) ? "page" : undefined} data-track={`plan-nav.${label.toLowerCase()}`}>
          {label}
        </Link>
      ))}
    </nav>
  );
}

/** A destination's title row: the title always matches the navigation label. */
export function WorkspaceHeading({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-sub">{description}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}
