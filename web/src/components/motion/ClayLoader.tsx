"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

interface ClayLoaderProps {
  label?: string;
  size?: number;
  color?: string;
}

/**
 * Airbnb-style 3D clay loader with soft pulsing ambient rings,
 * floating 3D hourglass, and smooth spring kinetics.
 */
export function ClayLoader({
  label,
  size = 64,
  color = "var(--accent)",
}: ClayLoaderProps) {
  const { reduced } = useMotionEnabled();

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "24px 16px",
      }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* Soft Ambient Diffuse Glow */}
        {!reduced && (
          <motion.div
            animate={{
              scale: [1, 1.3, 1],
              opacity: [0.35, 0.12, 0.35],
            }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{
              position: "absolute",
              inset: -6,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
              filter: "blur(8px)",
            }}
          />
        )}

        {/* Floating 3D Clay Hourglass */}
        <motion.div
          animate={
            reduced
              ? undefined
              : {
                  y: [0, -8, 0],
                  rotateZ: [-2, 2, -2],
                }
          }
          transition={{
            duration: 2.4,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{
            width: size,
            height: size,
            position: "relative",
            zIndex: 2,
          }}
        >
          <Image
            src="/illustrazioni/loading.webp"
            alt=""
            fill
            sizes={`${size}px`}
            style={{ objectFit: "contain" }}
          />
        </motion.div>

        {/* Orbiting Satellite Dots */}
        {!reduced && (
          <motion.div
            animate={{ rotate: 360 }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "linear",
            }}
            style={{
              position: "absolute",
              width: "100%",
              height: "100%",
              zIndex: 3,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: "50%",
                marginLeft: -4,
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ffffff",
                boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
              }}
            />
          </motion.div>
        )}

        {/* Contact Shadow Under Orb */}
        {!reduced && (
          <motion.div
            animate={{
              scaleX: [1, 0.7, 1],
              opacity: [0.35, 0.15, 0.35],
            }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{
              position: "absolute",
              bottom: 2,
              width: size * 0.5,
              height: 6,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.25)",
              filter: "blur(3px)",
              zIndex: 1,
            }}
          />
        )}
      </div>

      {label && (
        <p
          className="font-serif-italic"
          style={{
            fontSize: 14,
            color: "var(--inchiostro-70)",
            margin: 0,
            textAlign: "center",
          }}
        >
          {label}
        </p>
      )}
    </div>
  );
}
