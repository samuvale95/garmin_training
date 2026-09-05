"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useDragControls } from "framer-motion";
import { Illustration } from "@/components/Illustration";
import { SlideUp } from "@/components/motion/primitives";
import { useMotionEnabled } from "@/lib/motion";
import { sessionDetailLine } from "@/lib/format";
import { classifySession, sessionDistanceKm, type DisplaySession } from "@/lib/sessionVisuals";
import type { ScheduledWorkout } from "@/lib/types";

export interface DayCardData {
  id: string;
  session: DisplaySession;
  planIndex?: number;
  workout?: ScheduledWorkout;
}

/** How long a finger has to rest on a card before it is picked up, and how far it may
 * slide in the meantime. Below ~250ms the gesture fires while someone is only starting
 * to scroll; above ~400ms it feels broken. 320ms with an 8px slop is the range both
 * iOS and Android use for their own drag-to-reorder lists. */
const LONG_PRESS_MS = 320;
const MOVE_SLOP_PX = 8;

function haptic(pattern: number | number[]) {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(pattern);
  }
}

// ---- rest day --------------------------------------------------------------------------------

/** A day with nothing scheduled. Deliberately shorter and quieter than a session card:
 * an empty week used to render seven full-height cards with seven copies of the same
 * illustration, which drowned out the days that actually carry a session. The
 * illustration is kept for the first rest day of the week only -- one drawing per
 * screen, the way every other screen uses them. */
export function RestCard({ animate, delayMs, withIllustration }: { animate: boolean; delayMs: number; withIllustration: boolean }) {
  const visual = classifySession(null);
  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: visual.background,
        color: visual.foreground,
        borderRadius: "var(--radius-card)",
        padding: "14px 16px",
        minHeight: withIllustration ? 70 : 54,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <p style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Riposo</p>
      <p className="font-serif-italic" style={{ fontSize: 13.5, margin: 0, opacity: 0.8 }}>
        e va bene così
      </p>
      {withIllustration && visual.illustration && (
        <Illustration name={visual.illustration} width={56} height={62} breathe={false} active={animate} delayMs={200 + delayMs} />
      )}
    </SlideUp>
  );
}

// ---- session card ----------------------------------------------------------------------------

interface DraggableWeekCardProps {
  card: DayCardData;
  animate: boolean;
  delayMs: number;
  matchKm: number | null;
  /** True once this card has been picked up, so the row it came from can be marked. */
  onDragStateChange: (dragging: boolean) => void;
  /** Page-space pointer position, per frame, while the card is being carried. */
  onDragOver: (pageY: number) => void;
  onDrop: (card: DayCardData, pageY: number) => void;
  onPrefetch?: () => void;
}

type Phase = "idle" | "pressing" | "dragging";

/** One session card in Settimana. A tap opens it; a press and hold picks it up, and
 * releasing it over another day moves it there.
 *
 * The gesture is built by hand rather than handed to Framer's own `dragListener`
 * because the two things it has to keep apart -- scrolling the week and carrying a
 * card -- start out as the same touch:
 *
 * - The press timer is cancelled as soon as the finger travels `MOVE_SLOP_PX`, so a
 *   scroll that begins on a card is never mistaken for a drag.
 * - Once the timer fires, the card is lifted and `dragControls.start()` is handed the
 *   original pointerdown event, which is where the drag should originate from.
 *   Framer itself only begins moving the card after ~3px, so the lift and the movement
 *   read as one gesture.
 * - Native scrolling is suppressed by the list's non-passive `touchmove` listener (see
 *   `WeekDayList`), because `touch-action: none` on the card would also cost the user
 *   the ability to scroll the page by swiping over it.
 * - The click that a touch device synthesises after the release is swallowed, or every
 *   drop would also open the session it just moved.
 *
 * `dragSnapToOrigin` matters: on a same-day or off-list drop nothing about this card's
 * identity changes, so nothing remounts it to reset its dragged position -- the
 * snap-back has to be explicit. On a real move the card's `key` lives under a different
 * day row after the state update and this instance unmounts anyway. */
export function DraggableWeekCard({ card, animate, delayMs, matchKm, onDragStateChange, onDragOver, onDrop, onPrefetch }: DraggableWeekCardProps) {
  const { reduced } = useMotionEnabled();
  const dragControls = useDragControls();
  const [phase, setPhase] = useState<Phase>("idle");
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const suppressClick = useRef(false);

  const visual = classifySession(card.session);
  // A longer session gets a taller card, but over a much narrower band than it used
  // to: at 78-110px a whole week fits on one phone screen, which is the only reason
  // this tab exists.
  const height = 70 + Math.min(26, sessionDistanceKm(card.session) * 1.4);
  const detail = sessionDetailLine(card.session) || visual.label;

  const clearPress = useCallback(() => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
    pressOrigin.current = null;
  }, []);

  const endGesture = useCallback(() => {
    clearPress();
    if (armedRef.current) {
      armedRef.current = false;
      onDragStateChange(false);
      // The synthesised click lands a few ms after the release; anything later than
      // that is a genuine new tap and must still open the session.
      window.setTimeout(() => {
        suppressClick.current = false;
      }, 400);
    }
    setPhase("idle");
  }, [clearPress, onDragStateChange]);

  // Pointer capture is implicit for touch but not for mouse, so the release is listened
  // for on the window: a drag that ends with the cursor off the card still resets.
  useEffect(() => {
    if (phase === "idle") return;
    const stop = () => endGesture();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [phase, endGesture]);

  useEffect(() => () => clearPress(), [clearPress]);

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const nativeEvent = event.nativeEvent;
    pressOrigin.current = { x: event.clientX, y: event.clientY };
    setPhase("pressing");
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      armedRef.current = true;
      suppressClick.current = true;
      setPhase("dragging");
      onDragStateChange(true);
      haptic(14);
      dragControls.start(nativeEvent);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const origin = pressOrigin.current;
    if (!origin || armedRef.current) return;
    const travelled = Math.hypot(event.clientX - origin.x, event.clientY - origin.y);
    if (travelled > MOVE_SLOP_PX) {
      clearPress();
      setPhase("idle");
    }
  }

  const lifted = phase === "dragging";
  const body = (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      row
      style={{
        background: visual.background,
        color: visual.foreground,
        borderRadius: "var(--radius-card)",
        padding: "14px 16px",
        minHeight: height,
        position: "relative",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
      }}
    >
      <p style={{ fontSize: 14.5, fontWeight: 600, margin: 0, paddingRight: 54, letterSpacing: "-.01em" }}>{card.session.title}</p>
      <p className="font-serif-italic" style={{ fontSize: 13.5, margin: "4px 0 0", opacity: 0.85, paddingRight: 54 }}>
        {detail}
      </p>
      {matchKm != null && (
        <p className="font-mono" style={{ fontSize: 11, margin: "6px 0 0", opacity: 0.75 }}>
          svolto {matchKm.toFixed(1)} km
        </p>
      )}
      {visual.illustration && <Illustration name={visual.illustration} width={58} height={64} breathe={false} active={animate} delayMs={200 + delayMs} />}
    </SlideUp>
  );

  const href =
    card.planIndex != null
      ? `/session/${card.planIndex}`
      : card.workout?.scheduled_workout_id != null
        ? `/workout/${card.workout.scheduled_workout_id}?date=${card.session.date}`
        : null;

  return (
    <motion.div
      className={`week-card${lifted ? " is-dragging" : ""}`}
      drag="y"
      dragControls={dragControls}
      dragListener={false}
      dragMomentum={false}
      dragSnapToOrigin
      onDragEnd={(_event, info) => {
        onDrop(card, info.point.y);
        endGesture();
      }}
      onDrag={(_event, info) => onDragOver(info.point.y)}
      animate={
        reduced
          ? undefined
          : lifted
            ? { scale: 1.035, boxShadow: "0 18px 34px rgba(28,26,22,.26)" }
            : { scale: phase === "pressing" ? 0.988 : 1, boxShadow: "0 0px 0px rgba(28,26,22,0)" }
      }
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onContextMenu={(event) => {
        // Android's own long-press menu would otherwise open on top of the drag.
        if (phase !== "idle") event.preventDefault();
      }}
      onClickCapture={(event) => {
        if (!suppressClick.current) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
      style={{
        position: "relative",
        zIndex: lifted ? 30 : "auto",
        borderRadius: "var(--radius-card)",
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {href ? (
        <Link href={href} draggable={false} style={{ textDecoration: "none", color: "inherit" }} onPointerDown={onPrefetch}>
          {body}
        </Link>
      ) : (
        body
      )}
      <span
        aria-hidden="true"
        className="week-card__grip"
        style={{
          position: "absolute",
          top: 12,
          right: 14,
          display: "flex",
          flexDirection: "column",
          gap: 3,
          opacity: lifted ? 0.9 : 0.4,
          transition: "opacity 160ms var(--ease)",
        }}
      >
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ display: "flex", gap: 3 }}>
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: visual.foreground }} />
            <span style={{ width: 3, height: 3, borderRadius: "50%", background: visual.foreground }} />
          </span>
        ))}
      </span>
    </motion.div>
  );
}
