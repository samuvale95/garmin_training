"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { Avatar } from "@/components/Avatar";

export function Workspace({ children, navigation }: { children: React.ReactNode; navigation: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="workspace" data-section={pathname.split("/")[1]}>
    <a href="#workspace-content" className="skip-link">Vai al contenuto</a>
    <header className="workspace-header">
      <Link href="/today" aria-label="Passo, Oggi" data-track="workspace.home"><BrandMark height={25} /></Link>
      <Link href="/settings" className="workspace-profile" data-track="workspace.profile"><span>Profilo</span><Avatar size={30} /></Link>
    </header>
    <main id="workspace-content" className="workspace-content" tabIndex={-1}>{children}</main>
    {navigation}
  </div>;
}

export function PlanNavigation() {
  const pathname = usePathname();
  return <nav className="section-nav" aria-label="Sezioni del piano">
    {[["/week", "Calendario"], ["/week/programs", "Programmi"], ["/week/goals", "Obiettivi"]].map(([href, label]) =>
      <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined} data-track={`plan-nav.${label.toLowerCase()}`}>{label}</Link>
    )}
  </nav>;
}

export function WorkspaceHeading({ title, description, children }: { title: string; description?: string; children?: React.ReactNode }) {
  return <header className="workspace-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</header>;
}
