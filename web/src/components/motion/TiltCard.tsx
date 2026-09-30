"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  maxTilt?: number;
  glare?: boolean;
  scaleOnHover?: number;
  elevationShadow?: boolean;
  onClick?: () => void;
}

/**
 * 3D Airbnb-style Tilt Card.
 * Tilts subtly in perspective towards the mouse cursor using spring physics,
 * generates a moving soft specular glare, and allows child elements with translateZ
 * to have layered 3D parallax depth.
 */
export function TiltCard({
  children,
  className,
  style,
  maxTilt = 6.5,
  glare = true,
  scaleOnHover = 1.012,
  elevationShadow = true,
  onClick,
}: TiltCardProps) {
  const { reduced } = useMotionEnabled();
  const cardRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);

  // Raw mouse coordinates normalized from -0.5 to 0.5
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  // Organic spring physics for smooth, buttery inertia
  const springX = useSpring(rawX, { stiffness: 260, damping: 22, mass: 0.6 });
  const springY = useSpring(rawY, { stiffness: 260, damping: 22, mass: 0.6 });

  // Map to 3D rotation angles
  const rotateX = useTransform(springY, [-0.5, 0.5], [maxTilt, -maxTilt]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [-maxTilt, maxTilt]);

  // Glare position percentage
  const glareX = useTransform(springX, [-0.5, 0.5], ["0%", "100%"]);
  const glareY = useTransform(springY, [-0.5, 0.5], ["0%", "100%"]);

  // Dynamic soft shadow that moves opposite to the tilt
  const shadowX = useTransform(springX, [-0.5, 0.5], [10, -10]);
  const shadowY = useTransform(springY, [-0.5, 0.5], [18, 6]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (reduced || e.pointerType === "touch") return;
    const card = cardRef.current;
    if (!card) return;

    const rect = card.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    rawX.set(x);
    rawY.set(y);
  };

  const handlePointerEnter = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    setIsHovered(true);
  };

  const handlePointerLeave = () => {
    setIsHovered(false);
    rawX.set(0);
    rawY.set(0);
  };

  if (reduced) {
    return (
      <div
        ref={cardRef}
        className={className}
        style={{
          borderRadius: "var(--radius-card-lg)",
          ...style,
        }}
        onClick={onClick}
      >
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={cardRef}
      className={`airbnb-card-3d ${className ?? ""}`}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onClick={onClick}
      whileTap={{ scale: 0.985 }}
      whileHover={{ scale: scaleOnHover }}
      style={{
        position: "relative",
        transformStyle: "preserve-3d",
        perspective: 1100,
        rotateX: isHovered ? rotateX : 0,
        rotateY: isHovered ? rotateY : 0,
        boxShadow: elevationShadow
          ? isHovered
            ? "var(--shadow-airbnb-hover)"
            : "var(--shadow-airbnb-card)"
          : undefined,
        transition: "box-shadow 0.35s ease, border-color 0.3s ease",
        ...style,
      }}
    >
      {/* Moving Specular Glare */}
      {glare && (
        <motion.div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            pointerEvents: "none",
            zIndex: 15,
            opacity: isHovered ? 0.35 : 0,
            transition: "opacity 0.3s ease",
            background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0) 65%)",
            backgroundPosition: `${glareX} ${glareY}`,
          }}
        />
      )}

      {/* Card Content with 3D Depth */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          transformStyle: "preserve-3d",
        }}
      >
        {children}
      </div>
    </motion.div>
  );
}
