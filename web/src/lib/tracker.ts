/** Interaction log: records where the user taps, hesitates and gets stuck (`logging_plan.md`).
 *
 * Collection only. Events are queued in memory, mirrored to localStorage (so an offline
 * stretch or a closed app loses nothing), and sent in batches to `POST /events/batch`.
 * Never records what the user typed -- only where they interacted.
 *
 * The same pointer listeners also own one piece of behaviour: the click guard that makes
 * `aria-disabled` buttons inert (see `disabled.ts`). It runs whether tracking is on or not.
 */
import { getAccessToken } from "./auth";

export type EventType =
  | "tap" | "tap_disabled" | "dead_tap" | "rage_tap"
  | "tab_change" | "screen_view" | "modal_open" | "modal_close"
  | "flow_start" | "flow_step" | "flow_complete" | "flow_abandon"
  | "scroll_depth" | "api_error" | "slow_response" | "ui_error"
  | "app_foreground" | "app_background"
  | "screen_ready" | "load_abandon" | "long_loading" | "error_shown";

interface TrackedEvent {
  event_type: EventType;
  target?: string;
  path: string;
  occurred_at: number;
  viewport: string;
  metadata?: Record<string, unknown>;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";
const QUEUE_KEY = "passo-events-queue";
const PREF_KEY = "passo-tracking";
const MAX_QUEUE = 500;
const FLUSH_AT = 30;
const FLUSH_EVERY_MS = 10_000;
const MAX_BATCH = 100;
const RAGE_TAPS = 3;
const RAGE_WINDOW_MS = 1000;
const TAP_SLOP_PX = 10;
const SLOW_RESPONSE_MS = 3000;
const WATCH_EVERY_MS = 250;
/** A loading button worth reporting: past this it is a wait, not a blink. */
const LONG_LOADING_MS = 5000;
/** How long a screen must stay free of loading states to count as ready: a screen often
 * renders blank for a moment before its skeleton, and that blank is not "loaded". */
const READY_STABLE_MS = 500;

/** Build-time kill switch: `NEXT_PUBLIC_TRACKING=off`. The server has its own (it answers
 * with `x-tracking-disabled`), which needs a restart but no rebuild. */
const BUILD_ENABLED = process.env.NEXT_PUBLIC_TRACKING !== "off";
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";

let queue: TrackedEvent[] = [];
let sessionId = "";
let serverDisabled = false;
let flushing = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let installed = false;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function isTrackingEnabled(): boolean {
  if (!BUILD_ENABLED || serverDisabled) return false;
  return storage()?.getItem(PREF_KEY) !== "off";
}

export function setTrackingEnabled(enabled: boolean): void {
  try {
    storage()?.setItem(PREF_KEY, enabled ? "on" : "off");
  } catch {}
  if (!enabled) {
    queue = [];
    persist();
  }
}

function persist(): void {
  try {
    const s = storage();
    if (!s) return;
    if (queue.length === 0) s.removeItem(QUEUE_KEY);
    else s.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

function currentPath(): string {
  return typeof window === "undefined" ? "" : window.location.pathname;
}

/** Records one event. Cheap and synchronous; the network happens later, in batches. */
export function track(type: EventType, target?: string, metadata?: Record<string, unknown>): void {
  if (typeof window === "undefined" || !isTrackingEnabled()) return;
  queue.push({
    event_type: type,
    target,
    path: currentPath(),
    occurred_at: Date.now(),
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    metadata,
  });
  if (queue.length > MAX_QUEUE) queue = queue.slice(queue.length - MAX_QUEUE);
  if (queue.length >= FLUSH_AT) void flush();
  else scheduleFlush();
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_EVERY_MS);
}

/** Sends the queue. Events leave the queue only once the server has acknowledged them, so
 * a failed or offline send just keeps them for the next attempt. `keepalive` lets the
 * request outlive a closing page -- `sendBeacon` cannot carry the auth header. */
export async function flush(): Promise<void> {
  if (flushing || queue.length === 0 || !isTrackingEnabled()) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  flushing = true;
  const batch = queue.slice(0, MAX_BATCH);
  try {
    const token = await getAccessToken();
    if (!token) return;
    const response = await fetch(new URL("/events/batch", API_BASE_URL), {
      method: "POST",
      keepalive: true,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        events: batch,
        app_version: APP_VERSION,
        standalone: isStandalone(),
        user_agent: typeof navigator === "undefined" ? undefined : navigator.userAgent.slice(0, 120),
      }),
    });
    if (response.headers.get("x-tracking-disabled")) {
      serverDisabled = true;
      queue = [];
    } else if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
      // A 4xx other than rate limiting will never succeed on retry: drop rather than loop.
      queue = queue.slice(batch.length);
    }
    persist();
  } catch {
    // Offline or server down: keep the queue for next time.
  } finally {
    flushing = false;
    if (queue.length > 0 && isTrackingEnabled()) scheduleFlush();
  }
}

function isStandalone(): boolean {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

// ---- what was tapped ----------------------------------------------------------------

const INTERACTIVE = "a[href], button, [role=button], [role=tab], [role=link], [role=switch], input, select, textarea, summary, label";
const FREE_TEXT = "input, textarea, select, [contenteditable=true]";

/** A name for an element with no `data-track`. Digits are masked: a button's label can
 * carry a weight or a calorie figure, and the log must hold no health data. */
function fallbackTarget(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.matches(FREE_TEXT)) return tag;
  const raw = el.getAttribute("aria-label") ?? el.textContent ?? "";
  const text = raw.replace(/\s+/g, " ").trim().replace(/\d+/g, "#").slice(0, 40);
  return text ? `${tag}:${text}` : tag;
}

function trackName(el: Element | null, fallbackEl: Element): string {
  const named = el?.closest<HTMLElement>("[data-track]");
  return named?.dataset.track ?? fallbackTarget(fallbackEl);
}

function isInteractive(el: Element): Element | null {
  const found = el.closest(INTERACTIVE);
  if (found) return found;
  // Something the page made tappable without a semantic element (a div with a handler).
  return getComputedStyle(el).cursor === "pointer" ? el : null;
}

let lastTapTarget: string | null = null;

/** The target of the most recent tap: how a modal was closed is whatever was pressed last. */
export function lastTarget(): string | null {
  return lastTapTarget;
}

const recentTaps = new Map<string, number[]>();
let down: { x: number; y: number; t: number } | null = null;

function onPointerDown(event: PointerEvent): void {
  down = { x: event.clientX, y: event.clientY, t: event.timeStamp };
}

function onPointerUp(event: PointerEvent): void {
  const start = down;
  down = null;
  if (!isTrackingEnabled() || !start || !(event.target instanceof Element)) return;
  // A swipe or scroll ends in a pointerup too: only a stationary press is a tap.
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > TAP_SLOP_PX) return;
  const el = event.target;
  const position = {
    x: Math.round((event.clientX / window.innerWidth) * 100),
    y: Math.round((event.clientY / window.innerHeight) * 100),
  };

  const blocked = el.closest<HTMLElement>('[aria-disabled="true"], :disabled');
  if (blocked) {
    const target = trackName(blocked, blocked);
    track("tap_disabled", target, { ...position, reason: blocked.dataset.disabledReason ?? "unknown" });
    noteTap(target);
    return;
  }
  const active = isInteractive(el);
  if (active) {
    const target = trackName(active, active);
    track("tap", target, position);
    noteTap(target);
  } else {
    const target = trackName(el, el);
    track("dead_tap", target, position);
    noteTap(target);
  }
}

/** Three presses on one target within a second: the user is hammering something that
 * does not answer. */
function noteTap(target: string): void {
  lastTapTarget = target;
  const now = Date.now();
  const taps = (recentTaps.get(target) ?? []).filter((t) => now - t <= RAGE_WINDOW_MS);
  taps.push(now);
  if (taps.length >= RAGE_TAPS) {
    track("rage_tap", target, { count: taps.length, duration_ms: now - taps[0] });
    recentTaps.delete(target);
  } else {
    recentTaps.set(target, taps);
  }
}

/** Makes `aria-disabled` buttons inert. Registered in the capture phase on `document`, so
 * it runs before React's own listeners and no handler ever sees the click. */
function onClickGuard(event: MouseEvent): void {
  if (event.target instanceof Element && event.target.closest('[aria-disabled="true"]')) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  }
}

// ---- what the user waits on and what they are told ------------------------------------
//
// Read off the DOM, not wired into each screen: every loading state in the app draws one
// of the two shimmer primitives, and every busy button carries `dis(..., "in_caricamento")`,
// so one poll sees them all -- including on screens written after this.

const LOADING_SELECTOR = ".anim-clay-shimmer, .anim-sheen";
const BUSY_BUTTON_SELECTOR = '[data-disabled-reason="in_caricamento"]';
const ALERT_SELECTOR = '[role="alert"]';

/** The screen being loaded: from its `screen_view` until its last skeleton goes away. */
let screenLoad: { path: string; startedAt: number; sawLoading: boolean; clearSince: number | null; done: boolean } | null = null;
const busySince = new Map<Element, { since: number; target: string }>();
const shownAlerts = new WeakMap<Element, string>();
let watchTimer: ReturnType<typeof setInterval> | null = null;

/** Error copy as the user read it. Digits masked, like tap labels: a message can quote a
 * weight or a pace. */
function alertText(el: Element): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim().replace(/\d+/g, "#").slice(0, 160);
}

/** A new screen: closes the previous one's load (abandoned if it never finished) and
 * starts timing this one. Called on every route change. */
export function startScreenLoad(path: string): void {
  endScreenLoad("navigate");
  for (const [, busy] of busySince) reportBusy(busy, false);
  busySince.clear();
  screenLoad = { path, startedAt: Date.now(), sawLoading: false, clearSince: null, done: false };
  watch();
}

function endScreenLoad(reason: "navigate" | "background"): void {
  if (screenLoad && !screenLoad.done && screenLoad.sawLoading) {
    track("load_abandon", screenLoad.path, { ms: Date.now() - screenLoad.startedAt, reason });
  }
  screenLoad = null;
}

function reportBusy(busy: { since: number; target: string }, resolved: boolean): void {
  const ms = Date.now() - busy.since;
  if (ms >= LONG_LOADING_MS) track("long_loading", busy.target, { ms, resolved });
}

function watch(): void {
  if (!isTrackingEnabled() || document.visibilityState === "hidden") return;
  const now = Date.now();

  if (screenLoad && !screenLoad.done) {
    if (document.querySelector(LOADING_SELECTOR)) {
      screenLoad.sawLoading = true;
      screenLoad.clearSince = null;
    } else if (screenLoad.clearSince === null) {
      screenLoad.clearSince = now;
    } else if (now - screenLoad.clearSince >= READY_STABLE_MS) {
      screenLoad.done = true;
      // Ready from the moment the loading states went away, not from when that was
      // confirmed. `skeleton: false` is a screen that painted straight from cache.
      track("screen_ready", screenLoad.path, {
        ms: screenLoad.clearSince - screenLoad.startedAt,
        skeleton: screenLoad.sawLoading,
      });
    }
  }

  const busyNow = new Set(document.querySelectorAll(BUSY_BUTTON_SELECTOR));
  for (const el of busyNow) {
    if (!busySince.has(el)) busySince.set(el, { since: now, target: trackName(el, el) });
  }
  for (const [el, busy] of busySince) {
    if (!busyNow.has(el)) {
      reportBusy(busy, true);
      busySince.delete(el);
    }
  }

  for (const el of document.querySelectorAll(ALERT_SELECTOR)) {
    const text = alertText(el);
    if (text && shownAlerts.get(el) !== text) {
      shownAlerts.set(el, text);
      track("error_shown", trackName(el, el), { message: text });
    }
  }
}

function startWatching(): void {
  if (!watchTimer) watchTimer = setInterval(watch, WATCH_EVERY_MS);
}

function stopWatching(): void {
  if (watchTimer) clearInterval(watchTimer);
  watchTimer = null;
}

// ---- tabs, scroll, app lifecycle ----------------------------------------------------

let tabMethod: "tap" | "swipe" | null = null;

/** Called by whatever starts a tab change, so the resulting `tab_change` says how. */
export function markTabMethod(method: "tap" | "swipe"): void {
  tabMethod = method;
}

export function consumeTabMethod(): "tap" | "swipe" | "other" {
  const method = tabMethod ?? "other";
  tabMethod = null;
  return method;
}

const SCROLL_STEPS = [25, 50, 75, 100];
let scrollReached = 0;
let scrollTimer: ReturnType<typeof setTimeout> | null = null;

/** A new screen: depth restarts from zero. */
export function resetScrollDepth(): void {
  scrollReached = 0;
}

function onScroll(): void {
  if (scrollTimer) return;
  // Throttled: reading scrollHeight forces layout, and scrolling is the hot path.
  scrollTimer = setTimeout(() => {
    scrollTimer = null;
    const range = document.documentElement.scrollHeight - window.innerHeight;
    if (range <= 0) return;
    const percent = (window.scrollY / range) * 100;
    for (const step of SCROLL_STEPS) {
      if (step > scrollReached && percent >= step - 1) {
        scrollReached = step;
        track("scroll_depth", undefined, { percent: step });
      }
    }
  }, 300);
}

let foregroundSince = 0;

function onVisibility(): void {
  if (document.visibilityState === "hidden") {
    // Leaving while a screen still loads is the "it never loads" signal; a busy button
    // still spinning is reported unresolved. Both restart on the next screen.
    endScreenLoad("background");
    for (const [, busy] of busySince) reportBusy(busy, false);
    busySince.clear();
    stopWatching();
    track("app_background", undefined, { duration_ms: Date.now() - foregroundSince });
    persist();
    void flush();
  } else {
    foregroundSince = Date.now();
    startWatching();
    track("app_foreground");
    void flush();
  }
}

function onWindowError(event: ErrorEvent): void {
  track("ui_error", undefined, { message: String(event.message).slice(0, 200) });
}

function onRejection(event: PromiseRejectionEvent): void {
  const reason = event.reason;
  track("ui_error", undefined, { message: String(reason instanceof Error ? reason.message : reason).slice(0, 200), kind: "unhandled_rejection" });
}

export function trackUiError(error: Error): void {
  track("ui_error", undefined, { message: error.message.slice(0, 200), kind: "boundary" });
}

/** An endpoint with its ids and dates masked, never its query string. */
export function endpointOf(url: string): string {
  try {
    const path = new URL(url, API_BASE_URL).pathname;
    return path.replace(/\/(?:[0-9a-f-]{20,}|[\d-]+)(?=\/|$)/g, "/:id");
  } catch {
    return "unknown";
  }
}

export function trackApi(url: string, status: number, startedAt: number): void {
  const ms = Math.round(performance.now() - startedAt);
  const endpoint = endpointOf(url);
  if (endpoint === "/events/batch") return;
  if (status === 0 || status >= 400) track("api_error", endpoint, { status, ms });
  else if (ms > SLOW_RESPONSE_MS) track("slow_response", endpoint, { status, ms });
}

/** Wires every listener once, and returns what a clean-up needs. */
export function installTracker(): () => void {
  if (installed || typeof window === "undefined") return () => {};
  installed = true;
  sessionId = crypto.randomUUID();
  foregroundSince = Date.now();
  try {
    const saved = storage()?.getItem(QUEUE_KEY);
    if (saved) queue = [...(JSON.parse(saved) as TrackedEvent[]), ...queue].slice(-MAX_QUEUE);
  } catch {}

  // The guard goes first within the capture phase: the tracker must still see the tap.
  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("pointerup", onPointerUp, { capture: true, passive: true });
  document.addEventListener("click", onClickGuard, { capture: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", persist);
  window.addEventListener("online", () => void flush());
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onRejection);

  track("app_foreground");
  startWatching();
  void flush();

  return () => {
    installed = false;
    stopWatching();
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("pointerup", onPointerUp, { capture: true });
    document.removeEventListener("click", onClickGuard, { capture: true });
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pagehide", persist);
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
