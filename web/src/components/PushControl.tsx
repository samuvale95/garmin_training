"use client";

import { useState } from "react";
import { dis } from "@/lib/disabled";
import { BellIcon, CheckIcon, ShareIcon } from "@/components/Icons";
import { enablePush, sendTestPush, usePushState, type PushState } from "@/lib/push";

/** The one control for push reminders, wherever they are offered: what this device
 * can do right now and the single next step towards "on". It never says "attivati"
 * unless the server has the subscription -- the old card did, and sent nothing. */
export function PushControl({ compact = false }: { compact?: boolean }) {
  const { state, setState } = usePushState();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await enablePush();
      setState(next);
      if (next === "on") setMessage({ text: "Fatto: i promemoria arriveranno anche ad app chiusa.", error: false });
      else if (next === "denied") setMessage({ text: "Notifiche rifiutate: puoi riattivarle dalle impostazioni del telefono.", error: true });
    } catch {
      setMessage({ text: "Non sono riuscito ad attivarle. Controlla la connessione e riprova.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    const ok = await sendTestPush();
    setBusy(false);
    setMessage(
      ok
        ? { text: "Inviata dal server: dovrebbe arrivarti tra qualche secondo.", error: false }
        : { text: "Il server non trova questo telefono. Disattiva e riattiva le notifiche.", error: true }
    );
  }

  if (state == null) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <StateLine state={state} compact={compact} />

      {state === "off" && (
        <button
          type="button"
          data-track="push.enable"
          data-haptic="success"
          onClick={enable}
          {...dis(busy, "in_caricamento")}
          style={primary}
        >
          <BellIcon size={14} strokeWidth={2.2} />
          <span>{busy ? "Attivo…" : "Attiva le notifiche"}</span>
        </button>
      )}

      {state === "on" && (
        <button type="button" data-track="push.test" onClick={test} {...dis(busy, "in_caricamento")} style={secondary}>
          <BellIcon size={13} strokeWidth={2} />
          <span>{busy ? "Invio…" : "Mandami una notifica di prova"}</span>
        </button>
      )}

      {message && (
        <p
          role={message.error ? "alert" : undefined}
          style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, margin: 0, color: message.error ? "var(--rosso-testo)" : "var(--verde-testo)" }}
        >
          {!message.error && <CheckIcon size={13} strokeWidth={2.4} />}
          <span>{message.text}</span>
        </p>
      )}
    </div>
  );
}

function StateLine({ state, compact }: { state: PushState; compact: boolean }) {
  if (state === "on") {
    return compact ? null : (
      <p style={{ ...note, color: "var(--verde-testo)" }}>Attive su questo telefono: pasti all&apos;ora giusta e acqua 45 minuti prima di correre.</p>
    );
  }
  if (state === "needs-install") {
    return (
      <div style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-card)", padding: "10px 12px" }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Prima installa Passo sul telefono</p>
        <p style={{ fontSize: 12.5, margin: "4px 0 0", lineHeight: 1.4 }}>
          Su iPhone le notifiche arrivano solo all&apos;app nella schermata Home. Tocca{" "}
          <ShareIcon size={12} style={{ display: "inline", verticalAlign: "-1px" }} /> <strong>Condividi</strong> →{" "}
          <strong>Aggiungi alla schermata Home</strong>, poi apri Passo da lì e attivale.
        </p>
      </div>
    );
  }
  if (state === "denied") {
    return (
      <div role="alert" style={{ background: "var(--rosa-avviso)", color: "var(--rosso-testo)", borderRadius: "var(--radius-card)", padding: "10px 12px" }}>
        <p style={{ fontSize: 13, fontWeight: 700, margin: 0 }}>Notifiche bloccate</p>
        <p style={{ fontSize: 12.5, margin: "4px 0 0", lineHeight: 1.4 }}>
          Riattivale da <strong>Impostazioni → Notifiche → Passo</strong> sul telefono (o dai permessi del sito nel browser), poi torna qui.
        </p>
      </div>
    );
  }
  if (state === "unsupported") {
    return <p style={note}>Questo browser non riceve notifiche. Installa Passo sul telefono per averle.</p>;
  }
  return compact ? null : <p style={note}>Ti avviso all&apos;ora di ogni pasto e 45 minuti prima di correre, anche ad app chiusa.</p>;
}

const note = { fontSize: 12.5, color: "var(--inchiostro-70)", margin: 0, lineHeight: 1.4 } as const;

const primary = {
  alignSelf: "flex-start",
  background: "var(--inchiostro)",
  color: "var(--crema)",
  border: "none",
  borderRadius: "var(--radius-pill)",
  padding: "10px 18px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
} as const;

const secondary = {
  alignSelf: "flex-start",
  background: "rgba(34, 34, 34, 0.06)",
  color: "var(--inchiostro)",
  border: "1px solid rgba(34, 34, 34, 0.12)",
  borderRadius: "var(--radius-pill)",
  padding: "8px 16px",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
} as const;
