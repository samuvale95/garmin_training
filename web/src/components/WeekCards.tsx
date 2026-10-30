"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ContextLink } from "@/components/ContextLink";
import { motion, useDragControls } from "framer-motion";
import { CheckIcon } from "@/components/Icons";
import { useMotionEnabled } from "@/lib/motion";
import { sessionDetailLine } from "@/lib/format";
import { classifySession, effectiveTitle, sessionDistanceKm, sessionDurationMinutes, weekBounds, toDateKey, type DisplaySession } from "@/lib/sessionVisuals";
import type { ScheduledWorkout } from "@/lib/types";

export interface DayCardData {
  id: string;
  session: DisplaySession;
  /** The plan session's id; absent for a live Garmin calendar entry. */
  planId?: string;
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
// Props kept for call-site compatibility; a rest day is now one quiet line.
export function RestCard({}: { animate: boolean; delayMs: number; withIllustration: boolean }) {
  return <p className="calendar-day-rest">Riposo</p>;
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
  /** "oggi" / "prossimo": the session the week is waiting on, drawn louder than the rest
   * so it is found without reading the list. */
  emphasis?: "oggi" | "prossimo" | null;
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
// `animate`/`delayMs` are accepted for call-site compatibility; cards no longer enter one by one.
export function DraggableWeekCard({ card, matchKm, onDragStateChange, onDragOver, onDrop, onPrefetch, emphasis = null }: DraggableWeekCardProps) {
  const { reduced } = useMotionEnabled();
  const dragControls = useDragControls();
  const [phase, setPhase] = useState<Phase>("idle");
  const pressTimer = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const armedRef = useRef(false);
  const suppressClick = useRef(false);

  const visual = classifySession(card.session);
  const km = sessionDistanceKm(card.session);
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
  const minutes = Math.round(sessionDurationMinutes(card.session));
  const meta = [visual.label, minutes > 0 ? `${minutes} min` : null, km > 0 ? `${km.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km` : null].filter(Boolean).join(" · ");
  const body = (
    <div className="session-card" data-emphasis={emphasis ?? undefined} style={{ "--sport": visual.accent } as React.CSSProperties}>
      <span className="session-card-body">
        <span className="session-card-top">
          {emphasis && <span className="badge" data-tone="ink">{emphasis === "oggi" ? "Oggi" : "Prossima"}</span>}
          {card.session.priority === "key" && <span className="badge" data-tone="warn">Seduta chiave</span>}
          {card.session.is_short_active ? (
            <span className="badge" data-tone="accent">Versione breve</span>
          ) : card.session.short_variant ? (
            <span className="badge">Breve disponibile</span>
          ) : null}
        </span>
        <span className="session-card-title">{effectiveTitle(card.session)}</span>
        <span className="session-card-meta">{detail && detail !== visual.label && !meta.includes(detail) ? `${meta} · ${detail}` : meta}</span>
        {matchKm != null && (
          <span className="session-card-done"><CheckIcon size={13} strokeWidth={2.6} aria-hidden="true" /> Svolto, {matchKm.toLocaleString("it-IT", { maximumFractionDigits: 1 })} km</span>
        )}
      </span>
    </div>
  );

  const href =
    card.planId != null
      ? `/session/${card.planId}`
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
            ? { scale: 1.035, y: -4, boxShadow: "var(--shadow-float)" }
            : { scale: phase === "pressing" ? 0.985 : 1, y: 0, boxShadow: "0 0 0 0 rgba(0,0,0,0)" }
      }
      whileTap={reduced || lifted ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 400, damping: 26 }}
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
        borderRadius: "var(--radius-control)",
        touchAction: "manipulation",
        WebkitUserSelect: "none",
        userSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      {href ? (
        <ContextLink from={`/week?date=${toDateKey(weekBounds(new Date(`${card.session.date}T12:00:00`)).start)}`} data-track="week-cards.href" href={href} draggable={false} style={{ textDecoration: "none", color: "inherit" }} onPointerDown={onPrefetch}>
          {body}
        </ContextLink>
      ) : (
        body
      )}
      <span aria-hidden="true" className="session-card-grip" title="Tieni premuto per trascinare">
        {Array.from({ length: 6 }).map((_, i) => <i key={i} />)}
      </span>
    </motion.div>
  );
}
