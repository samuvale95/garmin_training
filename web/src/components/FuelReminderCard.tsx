"use client";

import { useEffect, useState } from "react";
import { SlideUp } from "@/components/motion/primitives";
import { BellIcon, DropletIcon, UtensilsIcon, CheckIcon } from "@/components/Icons";
import {
  calculateHydrationMl,
  calculateSnackGrams,
  getNotificationStatus,
  requestNotificationPermission,
  sendTestReminder,
  showNotification,
  type NotificationStatus,
} from "@/lib/notifications";
import type { DayTarget } from "@/lib/types";
import type { RunTimeSlot } from "@/components/FuelBlocks";

interface FuelReminderCardProps {
  todayTarget?: DayTarget | null;
  timeSlot: RunTimeSlot;
  animate?: boolean;
  delayMs?: number;
}

const SLOT_TIMES: Record<RunTimeSlot, { hour: number; minute: number; label: string }> = {
  mattina: { hour: 7, minute: 30, label: "07:30" },
  pomeriggio: { hour: 18, minute: 0, label: "18:00" },
  sera: { hour: 20, minute: 0, label: "20:00" },
};

function subtractMinutes(hour: number, minute: number, minsToSubtract: number): string {
  let totalMins = hour * 60 + minute - minsToSubtract;
  if (totalMins < 0) totalMins += 24 * 60;
  const h = Math.floor(totalMins / 60) % 24;
  const m = totalMins % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function FuelReminderCard({
  todayTarget,
  timeSlot,
  animate = true,
  delayMs = 0,
}: FuelReminderCardProps) {
  const [mounted, setMounted] = useState(false);
  const [notifStatus, setNotifStatus] = useState<NotificationStatus>({ supported: false, permission: "default" });
  const [testSent, setTestSent] = useState(false);
  const [schedulingFeedback, setSchedulingFeedback] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    setNotifStatus(getNotificationStatus());
  }, []);

  if (!todayTarget || todayTarget.load === "riposo") {
    return null;
  }

  const slotInfo = SLOT_TIMES[timeSlot] || SLOT_TIMES.pomeriggio;
  const snackTime = subtractMinutes(slotInfo.hour, slotInfo.minute, 90);
  const waterTime = subtractMinutes(slotInfo.hour, slotInfo.minute, 45);

  const hydrationMl = calculateHydrationMl(todayTarget.duration_minutes, todayTarget.load === "molto_lungo");
  const snackGrams = calculateSnackGrams(todayTarget.load);

  async function handleEnable() {
    const perm = await requestNotificationPermission();
    setNotifStatus({ supported: true, permission: perm });
    if (perm === "granted") {
      setSchedulingFeedback("Promemoria attivati! Riceverai un avviso prima della corsa.");
      setTimeout(() => setSchedulingFeedback(null), 4000);
    }
  }

  async function handleTest() {
    setTestSent(true);
    const ok = await sendTestReminder();
    if (ok) {
      setSchedulingFeedback("Notifica di prova inviata sul tuo dispositivo!");
    } else {
      setSchedulingFeedback("Non è stato possibile inviare la notifica. Verifica i permessi del browser.");
    }
    setTimeout(() => {
      setTestSent(false);
      setSchedulingFeedback(null), 4000;
    }, 4000);
  }

  return (
    <SlideUp
      active={animate}
      delayMs={delayMs}
      style={{
        background: "var(--crema-card)",
        borderRadius: "var(--radius-card-lg)",
        padding: 20,
        border: "1px solid rgba(34, 34, 34, 0.06)",
        marginTop: 18,
      }}
    >
      {/* Title & Status */}
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
        <p
          style={{
            fontSize: 12,
            fontWeight: 700,
            margin: 0,
            textTransform: "uppercase",
            letterSpacing: ".05em",
            color: "var(--inchiostro-50)",
          }}
        >
          Promemoria Merenda & Idratazione
        </p>

        {!mounted || notifStatus.permission === "default" ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "var(--radius-pill)",
              background: "rgba(34, 34, 34, 0.05)",
              color: "var(--inchiostro-50)",
            }}
          >
            Da abilitare
          </span>
        ) : notifStatus.permission === "granted" ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "var(--radius-pill)",
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              background: "rgba(16, 185, 129, 0.12)",
              color: "#059669",
            }}
          >
            <BellIcon size={12} strokeWidth={2.4} />
            <span>Notifiche attive</span>
          </span>
        ) : (
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "var(--radius-pill)",
              background: "rgba(239, 68, 68, 0.1)",
              color: "#dc2626",
            }}
          >
            Notifiche bloccate
          </span>
        )}
      </div>

      <p style={{ font: "600 17px/1.2 var(--font-sans)", letterSpacing: "-.01em", margin: "0 0 4px" }}>
        Programma pre-corsa (uscita alle {slotInfo.label})
      </p>
      <p className="font-serif-italic" style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: "0 0 14px", lineHeight: 1.4 }}>
        Il carburante e i liquidi fanno effetto se arrivano con il giusto anticipo rispetto alla partenza.
      </p>

      {/* Two steps: Snack and Water */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "14px 0" }}>
        {/* Snack block */}
        <div style={{ background: "rgba(245, 158, 11, 0.08)", padding: 12, borderRadius: "var(--radius-card)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#b45309", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <UtensilsIcon size={11} strokeWidth={2.2} />
              <span>Merenda (−90&apos;)</span>
            </span>
            <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: "#78350f" }}>
              ore {snackTime}
            </span>
          </div>
          <p className="font-mono" style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 2px", color: "#78350f" }}>
            ~{snackGrams} carbo
          </p>
          <span style={{ fontSize: 10.5, color: "var(--inchiostro-70)", lineHeight: 1.3, display: "block" }}>
            Banana con miele, 3 fette biscottate o barretta di cereali.
          </span>
        </div>

        {/* Hydration block */}
        <div style={{ background: "rgba(14, 165, 233, 0.08)", padding: 12, borderRadius: "var(--radius-card)" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "#0369a1", textTransform: "uppercase", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <DropletIcon size={11} strokeWidth={2.2} />
              <span>Acqua (−45&apos;)</span>
            </span>
            <span className="font-mono" style={{ fontSize: 13, fontWeight: 700, color: "#0c4a6e" }}>
              ore {waterTime}
            </span>
          </div>
          <p className="font-mono" style={{ fontSize: 18, fontWeight: 800, margin: "6px 0 2px", color: "#0c4a6e" }}>
            ~{hydrationMl} ml
          </p>
          <span style={{ fontSize: 10.5, color: "var(--inchiostro-70)", lineHeight: 1.3, display: "block" }}>
            1–2 bicchieri d&apos;acqua a piccoli sorsi per non appesantire lo stomaco.
          </span>
        </div>
      </div>

      {/* Action button & instructions */}
      <div style={{ marginTop: 12 }}>
        {notifStatus.permission === "granted" ? (
          <button
            type="button"
            onClick={handleTest}
            disabled={testSent}
            style={{
              background: "rgba(34, 34, 34, 0.06)",
              color: "var(--inchiostro)",
              border: "1px solid rgba(34, 34, 34, 0.12)",
              borderRadius: "var(--radius-pill)",
              padding: "8px 16px",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <BellIcon size={13} strokeWidth={2} />
            <span>{testSent ? "Invio in corso..." : "Invia notifica di prova"}</span>
          </button>
        ) : notifStatus.permission === "denied" ? (
          <div style={{ background: "rgba(239, 68, 68, 0.08)", padding: "10px 14px", borderRadius: "var(--radius-card)", marginTop: 6 }}>
            <p style={{ fontSize: 12.5, fontWeight: 700, color: "#b91c1c", margin: "0 0 4px" }}>
              Le notifiche risultano bloccate dal browser o dal sistema operativo
            </p>
            <p style={{ fontSize: 11.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.4 }}>
              Per riattivarle: tocca l&apos;icona delle impostazioni del sito (il lucchetto o levetta a sinistra dell&apos;URL nella barra del browser), vai su <strong>Permessi / Notifiche</strong> e seleziona <strong>Consenti</strong>. Poi ricarica la pagina.
            </p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              type="button"
              onClick={handleEnable}
              style={{
                alignSelf: "flex-start",
                background: "var(--inchiostro)",
                color: "#ffffff",
                border: "none",
                borderRadius: "var(--radius-pill)",
                padding: "10px 18px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <BellIcon size={14} strokeWidth={2.2} />
              <span>Consenti le notifiche</span>
            </button>
            <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: 0 }}>
              (Se stai usando un iPhone / Safari, aggiungi l&apos;app alla schermata Home con <em>Condividi → Aggiungi alla schermata Home</em> per ricevere le notifiche push).
            </p>
          </div>
        )}
      </div>

      {schedulingFeedback && (
        <p className="font-mono" style={{ fontSize: 11.5, color: "#047857", marginTop: 10, margin: "10px 0 0", display: "inline-flex", alignItems: "center", gap: 4 }}>
          <CheckIcon size={13} strokeWidth={2.4} />
          <span>{schedulingFeedback}</span>
        </p>
      )}
    </SlideUp>
  );
}
