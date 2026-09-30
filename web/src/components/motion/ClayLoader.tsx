"use client";

import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

interface ClayLoaderProps {
  label?: string;
  size?: number;
  color?: string;
}

/**
 * Airbnb-style 3D clay loader with soft pulsing ambient rings,
 * floating spheres, and smooth spring kinetics.
 */
export function ClayLoader({
  label,
  size = 54,
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
              scale: [1, 1.35, 1],
              opacity: [0.35, 0.1, 0.35],
            }}
            transition={{
              duration: 2.4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            style={{
              position: "absolute",
              inset: -4,
              borderRadius: "50%",
              background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
              filter: "blur(6px)",
            }}
          />
        )}

        {/* Central 3D Clay Orb */}
        <motion.div
          animate={
            reduced
              ? undefined
              : {
                  y: [0, -6, 0],
                  scale: [1, 1.05, 1],
                }
          }
          transition={{
            duration: 1.8,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{
            width: size * 0.65,
            height: size * 0.65,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 30%, #ffffff 0%, ${color} 70%, #9e1435 100%)`,
            boxShadow: "0 6px 16px -2px rgba(217, 45, 85, 0.35), inset 0 2px 4px rgba(255,255,255,0.6)",
            position: "relative",
            zIndex: 2,
          }}
        />

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
