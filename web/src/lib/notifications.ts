"use client";

/** Web Notifications & Reminders helper for Passo.
 *
 * Handles browser notification permissions, scheduling of pre-workout snack (merenda)
 * and hydration reminders based on scheduled training times.
 */

export interface NotificationStatus {
  supported: boolean;
  permission: NotificationPermission;
}

export function getNotificationStatus(): NotificationStatus {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { supported: false, permission: "default" };
  }
  return {
    supported: true,
    permission: Notification.permission,
  };
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "denied";
  }
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return "denied";
  }
}

export async function showNotification(title: string, options?: NotificationOptions): Promise<boolean> {
  const status = getNotificationStatus();
  if (!status.supported || status.permission !== "granted") {
    return false;
  }

  const defaultOptions: NotificationOptions = {
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    ...options,
  };

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(title, defaultOptions);
        return true;
      }
    }
    // Fallback to direct Notification instance
    new Notification(title, defaultOptions);
    return true;
  } catch {
    try {
      new Notification(title, defaultOptions);
      return true;
    } catch {
      return false;
    }
  }
}

export function calculateHydrationMl(durationMinOrKm?: number | null, isLong?: boolean): number {
  if (!durationMinOrKm || durationMinOrKm <= 0) return 350;
  // If value is > 25, it's duration in minutes; otherwise distance in km
  if (durationMinOrKm > 25) {
    if (isLong || durationMinOrKm >= 90) return 550;
    if (durationMinOrKm >= 50) return 450;
    return 350;
  }
  if (isLong || durationMinOrKm >= 18) return 550;
  if (durationMinOrKm >= 10) return 450;
  return 350;
}

export function calculateSnackGrams(load?: string): string {
  if (load === "molto_lungo" || load === "duro") {
    return "40–60g";
  }
  return "30–45g";
}

/** Sends an immediate test notification to confirm device delivery. */
export async function sendTestReminder(): Promise<boolean> {
  return showNotification("Passo · Promemoria Merenda & Acqua", {
    body: "Ecco come riceverai il promemoria! 30-50g di carboidrati e 400ml d'acqua prima di correre.",
    tag: "passo-test-reminder",
  });
}
