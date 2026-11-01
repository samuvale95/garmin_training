export const PRIMARY_NAV = [
  { href: "/today", label: "Oggi", icon: "M3 11 12 3l9 8M5 10v11h5v-7h4v7h5V10" },
  { href: "/week", label: "Piano", icon: "M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2" },
  { href: "/activities", label: "Attività", icon: "M4 19V5m0 14h16M8 15l4-5 4 2 4-7" },
  { href: "/body", label: "Recupero", icon: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" },
  { href: "/nutrition", label: "Nutrizione", icon: "M18 2v6a3 3 0 0 1-6 0V2M15 11v11M5 2v10a4 4 0 0 0 4 4v6M9 2v6" },
] as const;

export type PrimaryHref = (typeof PRIMARY_NAV)[number]["href"];

/** Which destination owns a route, so details and flows keep their section lit:
 * a session belongs to Piano, an analysis to Attività, the fuel pages to Nutrizione.
 * Null for the profile area and for screens outside the five destinations. */
export function sectionOf(pathname: string): PrimaryHref | null {
  const starts = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (starts("/today")) return "/today";
  if (starts("/body/fuel")) return "/nutrition";
  if (starts("/nutrition")) return "/nutrition";
  if (starts("/body/conflict")) return "/today";
  if (starts("/body")) return "/body";
  if (starts("/activities") || starts("/coach") || starts("/summary") || starts("/progress")) return "/activities";
  if (starts("/week") || starts("/session") || starts("/workout") || starts("/import") || starts("/diff") || starts("/sync") || starts("/confirm-deletions") || starts("/settings/goal")) return "/week";
  return null;
}

export function isPrimaryActive(pathname: string, href: string): boolean {
  return sectionOf(pathname) === href;
}

/** The five destinations themselves (and their sub-sections): these show the mobile
 * top bar and bottom bar. Everything else is a detail or a flow with its own way back. */
export function isPrimaryRoute(pathname: string): boolean {
  return ["/today", "/week", "/week/programs", "/week/goals", "/activities", "/body", "/body/load", "/nutrition", "/settings"].includes(pathname);
}

/** Entry and connection screens that run before or outside the app's frame. */
export function isBareRoute(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname.startsWith("/connect-garmin") || pathname.startsWith("/connect-strava");
}

/** Only local workspace pages can be return destinations. */
export function safeReturnHref(value: string | null, fallback = "/week"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return fallback;
  try {
    const url = new URL(value, "https://passo.local");
    const allowed = ["/today", "/week", "/week/programs", "/week/goals", "/activities", "/body", "/nutrition", "/settings"];
    return url.origin === "https://passo.local" && (allowed.includes(url.pathname) || /^\/week\/(?:programs|goals)(?:\/[a-zA-Z0-9_-]+)*$/.test(url.pathname)) ? `${url.pathname}${url.search}` : fallback;
  } catch { return fallback; }
}

export function withReturnTo(href: string, from: string): string {
  const url = new URL(href, "https://passo.local");
  url.searchParams.set("from", safeReturnHref(from));
  return `${url.pathname}${url.search}${url.hash}`;
}
