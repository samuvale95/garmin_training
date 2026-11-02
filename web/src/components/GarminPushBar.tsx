"use client";

import { useState } from "react";
import Link from "next/link";
import { SlideUp, StatusDot } from "@/components/motion/primitives";
import { useGarminPushStatus, useRetryGarminPush } from "@/lib/queries";
import { dis } from "@/lib/disabled";

/** One line that answers whether the plan reached Garmin Connect: on its way, all there, or what did
 * not make it and why -- with a retry. Replaces the plan-vs-calendar diff on Oggi, which
 * read the whole Garmin calendar on every visit. */
export function GarminPushBar({
  animate,
  delayMs = 0,
  quietWhenOk = false,
}: {
  animate: boolean;
  delayMs?: number;
  /** Home: say nothing when everything arrived -- only a problem earns the space. */
  quietWhenOk?: boolean;
}) {
  const status = useGarminPushStatus();
  const retry = useRetryGarminPush();
  const [open, setOpen] = useState(false);


  const data = status.data;
  const failed = data?.sessions.filter((s) => s.status === "failed") ?? [];
  const sending = !!data && (data.running || data.counts.pending > 0);
  const error = data?.run_error || (status.isError ? "Impossibile leggere lo stato dell’invio a Garmin Connect." : null) || (retry.isError ? "Impossibile avviare un nuovo invio a Garmin Connect." : null);
  const hasFailure = !!error || failed.length > 0;

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 12 }}>
      {hasFailure ? (
        <div
          role="alert"
          style={{ background: "var(--rosa-avviso)", borderRadius: "var(--radius-card)", padding: "12px 14px" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <StatusDot kind="error" size={8} />
            <button
              type="button"
              data-track="today.push-failed-details"
              onClick={() => setOpen((o) => !o)}
              style={{ all: "unset", cursor: "pointer", flex: 1, fontSize: 13.5, fontWeight: 650, color: "var(--rosso-testo)" }}
            >
              {error ? "Invio a Garmin Connect non riuscito" : failed.length === 1 ? "1 modifica non è arrivata su Garmin Connect" : `${failed.length} modifiche non sono arrivate su Garmin Connect`}
            </button>
            <button
              type="button"
              data-track="today.push-retry"
              {...dis(retry.isPending || !!data?.running, "in_caricamento")}
              onClick={() => { if (!retry.isPending && !data?.running) retry.mutate(); }}
              className="ux-button"
              style={{ padding: "6px 12px", fontSize: 12.5 }}
            >
              {data?.running || retry.isPending ? "Invio…" : "Riprova"}
            </button>
          </div>
          {open && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--inchiostro-70)" }}>
              {error && <li>{error} Controlla il collegamento Garmin nelle impostazioni.</li>}
              {failed.map((s) => (
                <li key={s.session_id}>
                  <b>{s.removing ? `Rimozione: ${s.title}` : s.title}</b>{s.date ? ` (${s.date})` : ""}: {s.error ?? "errore sconosciuto"}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : sending ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px" }}>
          <StatusDot kind="in_progress" size={7} />
          <span style={{ fontSize: 12.5, color: "var(--inchiostro-70)" }}>
            Salvato in Passo · invio a Garmin Connect in corso{data.counts.pending ? ` · ${data.counts.pending} ${data.counts.pending === 1 ? "modifica" : "modifiche"}` : ""}…
          </span>
        </div>
      ) : data && data.counts.ok > 0 && !quietWhenOk ? (
        <Link href="/week" data-track="today.push-ok" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", textDecoration: "none" }}>
          <StatusDot kind="success" size={7} />
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>Garmin Connect aggiornato: {data.counts.ok} sedute · sincronizza l&apos;orologio da Garmin Connect</span>
        </Link>
      ) : null}
    </SlideUp>
  );
}
