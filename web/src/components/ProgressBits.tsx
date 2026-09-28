"use client";

import Image from "next/image";
import { ILLUSTRATION_SOURCES } from "@/components/Illustration";
import type { Progress } from "@/lib/types";

/** The mascot: one of the app's own illustrations for the day's state. `crollo` is never
 * used -- the app does not show the user collapsing for missing a day. */
export function Mascot({ state, size }: { state: Progress["mascot"]["state"]; size: number }) {
  return (
    <div aria-hidden="true" className="anim-breath" style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <Image src={ILLUSTRATION_SOURCES[state]} alt="" fill sizes={`${size}px`} style={{ objectFit: "contain" }} />
    </div>
  );
}

/** Salva-serie tokens as filled and empty dots: how many weeks off the streak can absorb. */
export function Tokens({ tokens, max }: { tokens: number; max: number }) {
  return (
    <span aria-label={`${tokens} gettoni salva-serie su ${max}`} style={{ display: "inline-flex", gap: 4 }}>
      {Array.from({ length: max }).map((_, i) => (
        <span
          key={i}
          style={{
            width: 9,
            height: 9,
            borderRadius: "50%",
            background: i < tokens ? "var(--corallo)" : "transparent",
            border: "1.5px solid var(--corallo)",
          }}
        />
      ))}
    </span>
  );
}
