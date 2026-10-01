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
export const ILLUSTRATION_SOURCES = {
  corsa: "/illustrazioni/corsa.webp",
  attesa: "/illustrazioni/attesa.webp",
  esultanza: "/illustrazioni/esultanza.webp",
  riposo: "/illustrazioni/riposo.webp",
  forza: "/illustrazioni/forza.webp",
  bici: "/illustrazioni/bici.webp",
  crollo: "/illustrazioni/crollo.webp",
  sync: "/illustrazioni/sync.webp",
  fondo_lento: "/illustrazioni/fondo_lento.webp",
  fuel: "/illustrazioni/fuel.webp",
  prontezza: "/illustrazioni/prontezza.webp",
  sonno: "/illustrazioni/sonno.webp",
  fiamma: "/illustrazioni/fiamma.webp",
  scarpe: "/illustrazioni/scarpe.webp",
  loading: "/illustrazioni/loading.webp",
  strava_sync: "/illustrazioni/strava_sync.webp",
  obiettivo: "/illustrazioni/obiettivo.webp",
  scarico: "/illustrazioni/scarico.webp",
} as const;

export type IllustrationName = keyof typeof ILLUSTRATION_SOURCES;

// Fallbacks for newly registered illustrations until the user generates and places the WebP assets
const FALLBACKS: Partial<Record<IllustrationName, string>> = {
  fondo_lento: "/illustrazioni/corsa.webp",
  fuel: "/illustrazioni/attesa.webp",
  prontezza: "/illustrazioni/sync.webp",
  sonno: "/illustrazioni/riposo.webp",
  fiamma: "/illustrazioni/esultanza.webp",
  scarpe: "/illustrazioni/corsa.webp",
  loading: "/illustrazioni/loading.webp",
  strava_sync: "/illustrazioni/sync.webp",
  obiettivo: "/illustrazioni/esultanza.webp",
  scarico: "/illustrazioni/crollo.webp",
};

interface IllustrationProps {
  name: IllustrationName;
  width?: number;
  height?: number;
  size?: number;
  /** Only the protagonist illustration of a screen should breathe (MOTION.md §4: one per screen, counts toward the 3-concurrent-animation ceiling). */
  breathe?: boolean;
  /** Enable 3D organic clay levitation with soft reactive contact shadow */
  float?: boolean;
  active?: boolean;
  delayMs?: number;
  top?: number;
  left?: number;
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
  width: rawWidth,
  height: rawHeight,
  size,
  breathe = false,
  float = false,
  active = true,
  delayMs = 900,
  top,
  left,
  right,
  bottom,
  priority = false,
}: IllustrationProps) {
  const width = size ?? rawWidth ?? 64;
  const height = size ?? rawHeight ?? 64;
  const { reduced } = useMotionEnabled();
  const animate = active && !reduced;
  const src = ILLUSTRATION_SOURCES[name] ?? FALLBACKS[name] ?? "/illustrazioni/corsa.webp";

  const resolvedRight = right !== undefined ? right : left !== undefined ? undefined : 0;
  const resolvedBottom = bottom !== undefined ? bottom : top !== undefined ? undefined : 0;

  return (
    <div
      aria-hidden="true"
      className={animate ? "anim-land" : undefined}
      style={{
        position: "absolute",
        top,
        left,
        right: resolvedRight,
        bottom: resolvedBottom,
        width,
        height,
        transformOrigin: "bottom center",
        animationDelay: animate ? `${delayMs}ms` : undefined,
        transformStyle: "preserve-3d",
      }}
    >
      <div
        className={animate && breathe && !float ? "anim-breath" : undefined}
        style={{
          width: "100%",
          height: "100%",
          position: "relative",
          transform: float ? "translateZ(24px)" : undefined,
          transformStyle: "preserve-3d",
        }}
      >
        <Image
          src={src}
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
