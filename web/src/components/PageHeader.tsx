import Link from "next/link";

interface PageHeaderProps {
  /** Predecessor step in the current flow. Omit when there is none -- renders a home link instead. */
  backHref?: string;
  color?: string;
}

/** Escape hatch every non-tab screen renders: back to the previous step, or home if there is none. */
export function PageHeader({ backHref, color = "var(--inchiostro)" }: PageHeaderProps) {
  const href = backHref ?? "/today";
  const label = backHref ? "Indietro" : "Torna alla home";
  const glyph = backHref ? "←" : "⌂";

  return (
    <Link
      href={href}
      className="tap-target"
      aria-label={label}
      style={{ color, fontSize: 20, textDecoration: "none", flex: "none" }}
    >
      {glyph}
    </Link>
  );
}
