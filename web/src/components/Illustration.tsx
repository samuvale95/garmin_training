"use client";

import Image from "next/image";
import { useMotionEnabled } from "@/lib/motion";

const SOURCES = {
  corsa: "/illustrazioni/corsa.png",
  attesa: "/illustrazioni/attesa.png",
  esultanza: "/illustrazioni/esultanza.png",
  riposo: "/illustrazioni/riposo.png",
  forza: "/illustrazioni/forza.png",
  bici: "/illustrazioni/bici.png",
  crollo: "/illustrazioni/crollo.png",
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
        <Image src={SOURCES[name]} alt="" fill sizes={`${width}px`} style={{ objectFit: "contain", objectPosition: "bottom" }} />
      </div>
    </div>
  );
}
