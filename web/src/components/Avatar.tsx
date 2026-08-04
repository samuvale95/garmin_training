"use client";

import { usePassoStore } from "@/lib/store";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Local-profile initials circle shown wherever the design puts an account avatar
 * (screens 02, 08, 11, 15). Empty when no local display name has been set yet -- see
 * store.ts's `Profile`, edited from Settings; there is no real account behind it. */
export function Avatar({ size = 36 }: { size?: number }) {
  const name = usePassoStore((s) => s.profile.name);
  const label = initials(name);

  return (
    <div
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "var(--sabbia-scura)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: Math.round(size * 0.38),
        fontWeight: 600,
        color: "var(--inchiostro-70)",
        flex: "none",
      }}
    >
      {label}
    </div>
  );
}
