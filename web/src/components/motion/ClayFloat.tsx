"use client";

import type { CSSProperties, ReactNode } from "react";
import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

interface ClayFloatProps {
  children: ReactNode;
  shadow?: boolean;
  shadowWidth?: number | string;
  shadowHeight?: number;
  floatDistance?: number;
  duration?: number;
  delay?: number;
  depth?: number;
  className?: string;
  style?: CSSProperties;
}

/**
 * Renders an element floating in 3D space with a reactive ambient contact shadow.
 * In a 3D context (like TiltCard), the `depth` prop pops the element forward in Z-space.
 */
export function ClayFloat({
  children,
  shadow = true,
  shadowWidth = "70%",
  shadowHeight = 8,
  floatDistance = 7,
  duration = 3.6,
  delay = 0,
  depth = 26,
  className,
  style,
}: ClayFloatProps) {
  const { reduced } = useMotionEnabled();

  if (reduced) {
    return (
      <div className={className} style={{ position: "relative", ...style }}>
        {children}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{
        position: "relative",
        transformStyle: "preserve-3d",
        display: "inline-flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {/* Floating 3D Element */}
      <motion.div
        animate={{
          y: [0, -floatDistance, 0],
          rotateZ: [-1.2, 1.2, -1.2],
        }}
        transition={{
          duration,
          repeat: Infinity,
          ease: "easeInOut",
          delay,
        }}
        style={{
          position: "relative",
          zIndex: 2,
          transform: `translateZ(${depth}px)`,
          transformStyle: "preserve-3d",
        }}
      >
        {children}
      </motion.div>

      {/* Reactive Soft Contact Shadow */}
      {shadow && (
        <motion.div
          aria-hidden="true"
          animate={{
            scaleX: [1, 0.82, 1],
            scaleY: [1, 0.75, 1],
            opacity: [0.32, 0.16, 0.32],
          }}
          transition={{
            duration,
            repeat: Infinity,
            ease: "easeInOut",
            delay,
          }}
          style={{
            position: "absolute",
            bottom: -6,
            width: shadowWidth,
            height: shadowHeight,
            borderRadius: "50%",
            background: "radial-gradient(ellipse at center, rgba(30, 24, 20, 0.45) 0%, rgba(30, 24, 20, 0) 70%)",
            filter: "blur(3.5px)",
            pointerEvents: "none",
            zIndex: 1,
            transform: "translateZ(2px)",
          }}
        />
      )}
    </div>
  );
}
