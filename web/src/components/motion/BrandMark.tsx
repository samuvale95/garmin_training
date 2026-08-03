"use client";

import { useMotionEnabled } from "@/lib/motion";

const CANONICAL_HEIGHTS = [1, 0.52, 1, 0.77];

interface BrandMarkProps {
  /** Full-height of a live bar, in px. Below 18px the mark is always frozen. */
  height?: number;
  /** Color for bars 1, 3, 4 -- bar 2 is always coral, per MOTION.md. */
  color?: string;
  /** Force the frozen canonical frame regardless of the motion setting. */
  forceStatic?: boolean;
  /** True on screens 04/05/14 -- the mark is frozen there unconditionally. */
  stillZone?: boolean;
}

export function BrandMark({
  height = 28,
  color = "var(--inchiostro)",
  forceStatic = false,
  stillZone = false,
}: BrandMarkProps) {
  const { reduced } = useMotionEnabled(stillZone);
  const isStatic = forceStatic || reduced || height < 18;

  const barWidth = Math.max(4, Math.round(height * 0.14));
  const gap = Math.max(2.5, Math.round(height * 0.09));

  return (
    <div
      role="img"
      aria-label="Passo"
      style={{ display: "flex", alignItems: "flex-end", gap, height }}
    >
      {CANONICAL_HEIGHTS.map((fraction, i) => {
        const barColor = i === 1 ? "var(--corallo)" : color;
        if (isStatic) {
          return (
            <div
              key={i}
              style={{
                width: barWidth,
                height: Math.round(height * fraction),
                background: barColor,
                borderRadius: 3,
              }}
            />
          );
        }
        return (
          <div
            key={i}
            className="anim-stretch"
            style={{
              width: barWidth,
              height,
              background: barColor,
              borderRadius: 3,
              transformOrigin: "bottom",
              animationDelay: `${i * 120}ms`,
            }}
          />
        );
      })}
    </div>
  );
}
