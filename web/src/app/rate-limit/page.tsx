"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton } from "@/components/motion/primitives";
import { useGarminStatus } from "@/lib/queries";

export default function RateLimitPage() {
  const { data } = useGarminStatus();
  const [remaining, setRemaining] = useState<number | null>(null);

  // Seed/reset the local countdown when a fresh retry_after_seconds arrives, without
  // a dedicated effect+extra-render round trip -- "adjusting state during render"
  // (https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  const [seededFor, setSeededFor] = useState<number | null | undefined>(undefined);
  if (data?.retry_after_seconds !== seededFor) {
    setSeededFor(data?.retry_after_seconds ?? null);
    if (data?.retry_after_seconds != null) setRemaining(data.retry_after_seconds);
  }

  useEffect(() => {
    if (remaining == null || remaining <= 0) return;
    const timer = setInterval(() => setRemaining((r) => (r != null ? Math.max(0, r - 1) : r)), 1000);
    return () => clearInterval(timer);
  }, [remaining]);

  const minutes = remaining != null ? Math.floor(remaining / 60) : 0;
  const seconds = remaining != null ? remaining % 60 : 0;
  const initialTotal = data?.retry_after_seconds || 1;
  const progress = remaining != null ? 1 - remaining / initialTotal : 0;

  return (
    <div style={{ minHeight: "100dvh", background: "var(--rosa-avviso)", padding: "24px 22px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader color="var(--rosso-forte)" />
          <BrandMark height={22} color="var(--rosso-forte)" forceStatic stillZone />
        </div>
        <span style={{ fontSize: 11, color: "var(--rosa-testo-50)" }}>fermo · non insisto</span>
      </div>

      <h1 style={{ font: "600 26px/1.1 var(--font-outfit)", color: "var(--rosso-testo)", letterSpacing: "-.03em", margin: "20px 0 16px" }}>
        Aspetto io, così non peggiora
      </h1>

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20 }}>
        <p style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".1em", color: "var(--inchiostro-50)", margin: "0 0 10px" }}>
          Riprovo tra
        </p>
        <p className="font-mono" style={{ fontSize: 50, margin: "0 0 14px", letterSpacing: "-.02em" }}>
          {String(minutes).padStart(2, "0")}
          <span className="anim-tick">:</span>
          {String(seconds).padStart(2, "0")}
        </p>
        <div style={{ height: 6, borderRadius: 100, background: "#f3ddd2", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.max(0, Math.min(100, progress * 100))}%`, background: "var(--rosso-avviso)", borderRadius: 100 }} />
        </div>
        <p style={{ fontSize: 12, color: "var(--inchiostro-50)", marginTop: 14, lineHeight: 1.5 }}>
          Il blocco è sull&apos;indirizzo IP, non sull&apos;account: ogni tentativo in più lo allunga.
        </p>
      </div>

      <div style={{ background: "var(--corallo-chiaro)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 12 }}>
        <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 6px", color: "var(--corallo-testo)" }}>Cosa puoi fare adesso</p>
        <p style={{ fontSize: 12, color: "var(--corallo-testo)", margin: 0, lineHeight: 1.5 }}>
          Verifica la password su connect.garmin.com in un browser, senza riprovare da qui.
        </p>
      </div>

      <div style={{ background: "var(--verde-chiaro)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 10 }}>
        <p style={{ fontSize: 12, margin: 0, color: "var(--verde-testo)" }}>Il piano è al sicuro — le sessioni già scritte restano.</p>
      </div>

      <div style={{ flex: 1 }} />

      <PrimaryButton state={remaining && remaining > 0 ? "disabled" : "idle"} background="var(--rosso-forte)" textColor="var(--crema)">
        {remaining && remaining > 0 ? `Riprova tra ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : "Riprova ora"}
      </PrimaryButton>
    </div>
  );
}
