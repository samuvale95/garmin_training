"use client";

import { motion } from "framer-motion";
import { Illustration } from "@/components/Illustration";

interface LoadingIndicator3DProps {
  label?: string;
  size?: number;
  sublabel?: string;
  minHeight?: number | string;
}

export function LoadingIndicator3D({
  label = "Caricamento...",
  sublabel,
  size = 96,
  minHeight = 240,
}: LoadingIndicator3DProps) {
  return (
    <div
      role="status"
      aria-label={label}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        minHeight,
        padding: "32px 16px",
      }}
    >
      <motion.div
        animate={{
          y: [-6, 6, -6],
          rotateZ: [-2, 2, -2],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          position: "relative",
          width: size,
          height: size,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          filter: "drop-shadow(0 14px 24px rgba(255, 111, 89, 0.22))",
        }}
      >
        <Illustration
          name="loading"
          size={size}
          position="relative"
          breathe={true}
          float={true}
          active={true}
        />
      </motion.div>

      {/* Pulsing gentle ground shadow */}
      <motion.div
        animate={{
          scale: [0.75, 1.15, 0.75],
          opacity: [0.25, 0.5, 0.25],
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        style={{
          width: Math.round(size * 0.65),
          height: 8,
          background: "radial-gradient(ellipse at center, rgba(31, 26, 23, 0.35) 0%, transparent 75%)",
          borderRadius: "50%",
          marginTop: 6,
        }}
      />

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        style={{
          font: "600 14px/1.3 var(--font-sans)",
          color: "var(--inchiostro)",
          margin: "16px 0 0",
          letterSpacing: "-.01em",
        }}
      >
        {label}
      </motion.p>

      {sublabel && (
        <p
          className="font-serif-italic"
          style={{
            fontSize: 12.5,
            color: "var(--inchiostro-50)",
            margin: "4px 0 0",
          }}
        >
          {sublabel}
        </p>
      )}
    </div>
  );
}
