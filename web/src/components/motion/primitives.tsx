"use client";

import type { CSSProperties, ElementType, ReactNode } from "react";
import { motion } from "framer-motion";
import { useMotionEnabled } from "@/lib/motion";

// ---- entrance primitives (MOTION.md §3.1) --------------------------------------------------

interface WordInProps {
  children: ReactNode;
  active?: boolean;
  delayMs?: number;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

export function WordIn({ children, active = true, delayMs = 0, as: Tag = "div", className, style }: WordInProps) {
  const { reduced } = useMotionEnabled();
  const animate = active && !reduced;
  const MotionTag = (typeof Tag === "string" ? (motion as any)[Tag] : motion.div) || motion.div;

  if (!animate) {
    const Component = Tag as any;
    return <Component className={className} style={style}>{children}</Component>;
  }

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 26,
        mass: 0.6,
        delay: Math.min(delayMs, 200) / 1000,
      }}
      style={style}
    >
      {children}
    </MotionTag>
  );
}

interface SlideUpProps {
  children: ReactNode;
  active?: boolean;
  delayMs?: number;
  row?: boolean;
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
}

export function SlideUp({ children, active = true, delayMs = 0, row = false, as: Tag = "div", className, style }: SlideUpProps) {
  const { reduced } = useMotionEnabled();
  const animate = active && !reduced;

  if (!animate) {
    const Component = Tag as any;
    return <Component className={className} style={style}>{children}</Component>;
  }

  const MotionTag = (typeof Tag === "string" ? (motion as any)[Tag] : motion.div) || motion.div;

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: row ? 8 : 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: "spring",
        stiffness: 320,
        damping: 26,
        mass: 0.7,
        delay: Math.min(delayMs, 300) / 1000,
      }}
      style={style}
    >
      {children}
    </MotionTag>
  );
}

interface BarGrowProps {
  /** 0-1 */
  value: number;
  active?: boolean;
  delayMs?: number;
  vertical?: boolean;
  color?: string;
  trackColor?: string;
  height?: number | string;
  className?: string;
}

export function BarGrow({ value, active = true, delayMs = 0, vertical = false, color = "var(--corallo)", trackColor = "var(--sabbia-chip)", height = 8, className }: BarGrowProps) {
  const { reduced } = useMotionEnabled();
  const animate = active && !reduced;
  const clamped = Math.max(0, Math.min(1, value));

  if (vertical) {
    return (
      <div className={className} style={{ position: "relative", width: "100%", height: "100%", background: trackColor, borderRadius: 100, overflow: "hidden", display: "flex", alignItems: "flex-end" }}>
        <motion.div
          initial={animate ? { height: 0 } : false}
          animate={{ height: `${clamped * 100}%` }}
          transition={{ type: "spring", stiffness: 260, damping: 26, delay: Math.min(delayMs, 250) / 1000 }}
          style={{
            width: "100%",
            background: color,
            borderRadius: 100,
          }}
        />
      </div>
    );
  }

  return (
    <div className={className} style={{ height, borderRadius: 100, background: trackColor, overflow: "hidden" }}>
      <motion.div
        initial={animate ? { width: 0 } : false}
        animate={{ width: `${clamped * 100}%` }}
        transition={{ type: "spring", stiffness: 260, damping: 26, delay: Math.min(delayMs, 250) / 1000 }}
        style={{
          height: "100%",
          background: color,
          borderRadius: 100,
        }}
      />
    </div>
  );
}

// ---- attention / status indicators (MOTION.md §6) ------------------------------------------

/** The attention ring -- MOTION.md §6.1: at most one of these per screen. */
export function PulseRing({ size = 8, color = "var(--corallo)" }: { size?: number; color?: string }) {
  const { reduced } = useMotionEnabled();
  return (
    <span style={{ position: "relative", width: size, height: size, flex: "none", display: "inline-block" }}>
      <span style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
      {reduced ? (
        <span style={{ position: "absolute", inset: -3, borderRadius: "50%", border: `2px solid ${color}` }} />
      ) : (
        <span className="anim-pulse-ring" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: color }} />
      )}
    </span>
  );
}

type StatusKind = "active" | "success" | "error" | "in_progress" | "queued";

const STATUS_COLORS: Record<StatusKind, string> = {
  active: "var(--verde-tratto)",
  success: "var(--verde)",
  error: "var(--corallo-chiaro)",
  in_progress: "var(--corallo)",
  queued: "var(--inchiostro-50)",
};

export function StatusDot({ kind, size = 8 }: { kind: StatusKind; size?: number }) {
  const { reduced } = useMotionEnabled();
  const color = STATUS_COLORS[kind];
  if (kind === "in_progress") {
    return <PulseRing size={size} color={color} />;
  }
  const pulsing = kind === "active" && !reduced;
  return (
    <span
      className={pulsing ? "anim-dot-pulse" : undefined}
      style={{ width: size, height: size, borderRadius: "50%", background: color, display: "inline-block" }}
    />
  );
}

/** Draws once to its value; re-mount (change `value`) to redraw -- see ProgressRing's
 * caller, which should key on the rounded value so unrelated re-renders don't replay it. */
export function ProgressRing({
  value,
  size = 104,
  strokeWidth = 11,
  color = "var(--corallo)",
  trackColor = "rgba(28,26,22,.13)",
  children,
}: {
  value: number; // 0-1
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  children?: ReactNode;
}) {
  const { reduced } = useMotionEnabled();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - Math.max(0, Math.min(1, value)));

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={reduced ? offset : undefined}
          className={reduced ? undefined : "anim-trace"}
          style={
            reduced
              ? undefined
              : ({
                  animation: `mkTrace 1.5s var(--ease) both`,
                  ["--from" as string]: circumference,
                  ["--to" as string]: offset,
                } as CSSProperties)
          }
        />
      </svg>
      {children && (
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ---- primary button (MOTION.md §5.1) ---------------------------------------------------------

type ButtonState = "idle" | "loading" | "success" | "disabled";

interface PrimaryButtonProps {
  children: ReactNode;
  onClick?: () => void;
  state?: ButtonState;
  sheen?: boolean;
  fillColor?: string;
  successColor?: string;
  background?: string;
  textColor?: string;
  type?: "button" | "submit";
}

export function PrimaryButton({
  children,
  onClick,
  state = "idle",
  sheen = false,
  fillColor = "var(--accent)",
  successColor = "var(--verde)",
  background = "var(--accent)",
  textColor = "var(--crema)",
  type = "button",
}: PrimaryButtonProps) {
  const { reduced } = useMotionEnabled();
  const disabled = state === "disabled" || state === "loading";
  const isSuccess = state === "success";
  const isLoading = state === "loading";

  return (
    <motion.button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="tap-target"
      whileTap={reduced || disabled ? undefined : { scale: 0.96 }}
      whileHover={reduced || disabled ? undefined : { scale: 1.015, y: -1 }}
      transition={{ type: "spring", stiffness: 450, damping: 25 }}
      style={{
        position: "relative",
        overflow: "hidden",
        border: "none",
        borderRadius: "var(--radius-pill)",
        padding: "16px 22px",
        width: "100%",
        fontSize: 16,
        fontWeight: 600,
        cursor: disabled ? "default" : "pointer",
        background: state === "disabled" ? "var(--sabbia-chip)" : isSuccess ? successColor : background,
        color: state === "disabled" ? "var(--inchiostro-35)" : isSuccess ? "var(--verde-testo)" : textColor,
        boxShadow: disabled ? "none" : "0 4px 14px rgba(232, 98, 58, 0.22)",
      }}
    >
      {!reduced && !disabled && (
        <span
          aria-hidden="true"
          className={isSuccess ? "anim-sweep-once" : isLoading ? "anim-sweep-loop" : "anim-sweep-once"}
          style={{ position: "absolute", inset: 0, background: isSuccess ? successColor : fillColor, zIndex: 0 }}
        />
      )}
      {!reduced && sheen && state === "idle" && (
        <span
          aria-hidden="true"
          className="anim-sheen"
          style={{
            position: "absolute",
            inset: 0,
            width: "38%",
            background: "linear-gradient(90deg, rgba(247,148,112,0), rgba(247,148,112,.5), rgba(247,148,112,0))",
            zIndex: 1,
          }}
        />
      )}
      <span style={{ position: "relative", zIndex: 2 }}>{children}</span>
    </motion.button>
  );
}

// ---- skeleton loading (MOTION.md §7.1 -- no spinners) ----------------------------------------

export function Skeleton({ width = "100%", height = 16, radius = 12 }: { width?: number | string; height?: number | string; radius?: number }) {
  return (
    <div
      className="anim-clay-shimmer"
      style={{
        width,
        height,
        borderRadius: radius,
        background: "var(--sabbia)",
        position: "relative",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.03)",
        border: "1px solid rgba(0,0,0,0.03)",
      }}
    />
  );
}
