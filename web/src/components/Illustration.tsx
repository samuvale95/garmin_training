"use client";

import Image from "next/image";
import { useMotionEnabled } from "@/lib/motion";

/** 640px WebP (alpha preserved), which is 2x the largest size any of these is ever drawn
 * at (212px, the entry screen's hero). They used to ship as 1024px PNGs of ~1.5 MB each
 * -- 10 MB for a set displayed at 64-212px, with Settimana rendering seven of them in one
 * screen. The 1024px originals live in `web/assets-src/illustrazioni/`, outside `public/`,
 * so they are kept but never served; re-encode from there if a bigger size is ever
 * needed:
 *   cwebp -q 82 -resize 640 640 -alpha_q 100 <src>.png -o public/illustrazioni/<name>.webp
 */
const SOURCES = {
  corsa: "/illustrazioni/corsa.webp",
  attesa: "/illustrazioni/attesa.webp",
  esultanza: "/illustrazioni/esultanza.webp",
  riposo: "/illustrazioni/riposo.webp",
  forza: "/illustrazioni/forza.webp",
  bici: "/illustrazioni/bici.webp",
  crollo: "/illustrazioni/crollo.webp",
} as const;

export type IllustrationName = keyof typeof SOURCES;

interface IllustrationProps {
  name: IllustrationName;
  width: number;
  height: number;
  /** Only the protagonist illustration of a screen should breathe (MOTION.md §4: one per screen, counts toward the 3-concurrent-animation ceiling). */
  breathe?: boolean;
  active?: boolean;
  delayMs?: number;
  right?: number;
  bottom?: number;
  /** True for the above-the-fold hero illustration on a screen's first paint (e.g. the entry screen), so Next avoids the "missing priority on the LCP image" warning. */
  priority?: boolean;
}

// mkLand (translate/scale/opacity) and mkBreath (scale) are kept on two nested
// elements rather than combined on one, so neither ever contends with the other for
// the `transform` property mid-animation (the exact pitfall MOTION.md warns about
// for mkPulseRing, applied here defensively too).
export function Illustration({
  name,
  width,
  height,
  breathe = true,
  active = true,
  delayMs = 900,
  right = 0,
  bottom = 0,
  priority = false,
}: IllustrationProps) {
  const { reduced } = useMotionEnabled();
  const animate = active && !reduced;

  return (
    <div
      aria-hidden="true"
      className={animate ? "anim-land" : undefined}
      style={{
        position: "absolute",
        right,
        bottom,
        width,
        height,
        transformOrigin: "bottom center",
        animationDelay: animate ? `${delayMs}ms` : undefined,
      }}
    >
      <div
        className={animate && breathe ? "anim-breath" : undefined}
        style={{ width: "100%", height: "100%", position: "relative" }}
      >
        <Image
          src={SOURCES[name]}
          alt=""
          fill
          sizes={`${width}px`}
          priority={priority}
          style={{ objectFit: "contain", objectPosition: "bottom" }}
        />
      </div>
    </div>
  );
}
