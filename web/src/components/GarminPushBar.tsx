"use client";

import { useState } from "react";
import Link from "next/link";
import { SlideUp, StatusDot } from "@/components/motion/primitives";
import { useGarminPushStatus, useRetryGarminPush } from "@/lib/queries";
import { dis } from "@/lib/disabled";

/** One line that answers "is my plan on the watch?": on its way, all there, or what did
 * not make it and why -- with a retry. Replaces the plan-vs-calendar diff on Oggi, which
 * read the whole Garmin calendar on every visit. */
export function GarminPushBar({ animate, delayMs = 0 }: { animate: boolean; delayMs?: number }) {
  const status = useGarminPushStatus();
  const retry = useRetryGarminPush();
  const [open, setOpen] = useState(false);


  const data = status.data;
  const failed = data?.sessions.filter((s) => s.status === "failed") ?? [];
  const sending = !!data && (data.running || data.counts.pending > 0);

  return (
    <SlideUp active={animate} delayMs={delayMs} style={{ marginTop: 12 }}>
      {!data ? null : failed.length > 0 ? (
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
              {failed.length === 1 ? "1 seduta non è arrivata su Garmin" : `${failed.length} sedute non sono arrivate su Garmin`}
            </button>
            <button
              type="button"
              data-track="today.push-retry"
              {...dis(retry.isPending || sending, "in_caricamento")}
              onClick={() => { if (!retry.isPending && !sending) retry.mutate(); }}
              className="ux-button"
              style={{ padding: "6px 12px", fontSize: 12.5 }}
            >
              {sending ? "Invio…" : "Riprova"}
            </button>
          </div>
          {open && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--inchiostro-70)" }}>
              {failed.map((s) => (
                <li key={s.session_id}>
                  <b>{s.title}</b> ({s.date}): {s.error ?? "errore sconosciuto"}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : sending ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px" }}>
          <StatusDot kind="in_progress" size={7} />
          <span style={{ fontSize: 12.5, color: "var(--inchiostro-70)" }}>
            Invio a Garmin in corso{data.counts.pending ? ` · ${data.counts.pending} ${data.counts.pending === 1 ? "seduta" : "sedute"}` : ""}…
          </span>
        </div>
      ) : data.counts.ok > 0 ? (
        <Link href="/week" data-track="today.push-ok" style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", textDecoration: "none" }}>
          <StatusDot kind="success" size={7} />
          <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>Piano sull&apos;orologio: {data.counts.ok} sedute aggiornate</span>
        </Link>
      ) : null}
    </SlideUp>
  );
}
