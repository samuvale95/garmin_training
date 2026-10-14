"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "./apiClient";

/** Web Push on this device: whether reminders can reach it with the app closed, and
 * the calls that make it so (the server half is `training_plan/push.py`).
 *
 * The states, in the order a user walks through them:
 * - `unsupported`: this browser has no push at all.
 * - `needs-install`: an iPhone in Safari. iOS only gives push to apps added to the Home
 *   Screen, so the only honest next step is "installa l'app", not a permission prompt
 *   that cannot work.
 * - `denied`: the user said no; only the system settings can undo it.
 * - `off`: allowed or not yet asked, but this device is not subscribed.
 * - `on`: subscribed, and the server knows it.
 */
export type PushState = "unsupported" | "needs-install" | "denied" | "off" | "on";

// Every `usePushState` on screen (the card, the settings, the scheduler) hears about a
// change made by any of them.
const STATE_EVENT = "passo-push-state";

function announce(state: PushState): PushState {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<PushState>(STATE_EVENT, { detail: state }));
  return state;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

export async function getPushState(): Promise<PushState> {
  if (typeof window === "undefined") return "unsupported";
  if (!pushSupported()) return isIOS() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function sendSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  await apiPost("/push/subscribe", { endpoint: json.endpoint, keys: json.keys });
}

/** Ask, subscribe, tell the server. Must run from a tap: Safari refuses the permission
 * prompt outside a user gesture. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return getPushState();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return announce(permission === "denied" ? "denied" : "off");
  const reg = await registration();
  if (!reg) return "unsupported";
  await navigator.serviceWorker.ready;
  const { public_key } = await apiGet<{ public_key: string }>("/push/public-key");
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with another server key cannot be used: replace it.
  const current = sub?.options.applicationServerKey;
  if (sub && current) {
    const a = new Uint8Array(current);
    const b = keyBytes(public_key);
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(public_key) });
  await sendSubscription(sub);
  return announce("on");
}

export async function disablePush(): Promise<PushState> {
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await apiPost("/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return announce(await getPushState());
}

/** A real push through the server -- the only test that says anything about the closed
 * app. Resolves false when the server has no device for this account. */
export async function sendTestPush(): Promise<boolean> {
  try {
    await apiPost("/push/test");
    return true;
  } catch {
    return false;
  }
}

/** Re-send this device's subscription: the browser may rotate it (the service worker
 * says so with a message), and the server may have dropped it after a failed send. */
export async function refreshSubscription(): Promise<void> {
  if (!pushSupported() || Notification.permission !== "granted") return;
  const reg = await registration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) await sendSubscription(sub).catch(() => {});
}

/** The device's push state, kept current when the app comes back to the foreground
 * (permission can change in the system settings meanwhile). */
export function usePushState() {
  const [state, setState] = useState<PushState | null>(null);
  const refresh = useCallback(() => {
    getPushState().then(setState).catch(() => setState("unsupported"));
  }, []);
  useEffect(() => {
    refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    const onChange = (event: Event) => setState((event as CustomEvent<PushState>).detail);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(STATE_EVENT, onChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(STATE_EVENT, onChange);
    };
  }, [refresh]);
  return { state, setState, refresh };
}
