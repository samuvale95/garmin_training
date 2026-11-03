"use client";
import { WatchIcon, SparklesIcon, UploadIcon } from "@/components/Icons";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { PrimaryButton, WordIn, SlideUp } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useGarminStatus, usePlanQuery } from "@/lib/queries";
import { useScreenReady } from "@/lib/useScreenReady";

export default function EntryPage() {
  const router = useRouter();
  const { data: plan } = usePlanQuery();
  const status = useGarminStatus();
  useScreenReady(!!plan || !status.isPending);
  const garminConnected = status.data?.connected ?? false;
  const animate = useMountOnce("entry");

  // A device that already has a plan, or an already-connected Garmin session (e.g.
  // opening the app on a new device/browser while the server-side session is still
  // valid), skips the welcome screen entirely -- there is no account to "log into,"
  // so there is nothing to gate a returning visit on.
  useEffect(() => {
    if (plan || garminConnected) router.replace("/today");
  }, [plan, garminConnected, router]);

  useEffect(() => {
    router.prefetch("/connect-garmin");
    router.prefetch("/week/programs/new?source=ai");
    router.prefetch("/week/programs/new?source=import");
  }, [router]);

  // Wait for the first status check before deciding to show the welcome copy --
  // otherwise an already-connected user briefly sees it while the check lands. Only the
  // headline and CTA wait; the brand row is painted immediately, so the app never opens
  // on a blank screen (this whole branch used to `return null`).
  const decided = !plan && !garminConnected && !status.isPending;
  if (!decided) {
    return (
      <div style={{ padding: "30px 22px 0", minHeight: "100dvh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BrandMark height={26} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>Passo</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "30px 22px 0", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <BrandMark height={26} />
        <span style={{ fontSize: 18, fontWeight: 600 }}>Passo</span>
      </div>

      <div style={{ marginTop: 32 }}>
        <WordIn active={animate} delayMs={0} style={{ font: "600 40px/1 var(--font-sans)", letterSpacing: "-.04em" }}>
          Il tuo piano,
        </WordIn>
        <WordIn active={animate} delayMs={100} style={{ font: "600 40px/1.06 var(--font-sans)", letterSpacing: "-.04em" }}>
          da dove
        </WordIn>
        <WordIn active={animate} delayMs={200} style={{ font: "600 40px/1.06 var(--font-sans)", letterSpacing: "-.04em", color: "var(--accent)" }}>
          iniziamo?
        </WordIn>
      </div>

      <SlideUp active={animate} delayMs={300} className="font-serif-italic" style={{ fontSize: 18, color: "var(--inchiostro-70)", marginTop: 16, maxWidth: 280 }}>
        Scegli come partire. Garmin è facoltativo: puoi collegarlo ora o quando vuoi dalle impostazioni.
      </SlideUp>

      <SlideUp active={animate} delayMs={400} style={{ position: "relative", height: 150, marginTop: 22 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--corallo)",
            borderRadius: "var(--radius-card-lg)",
            overflow: "hidden",
            boxSizing: "border-box",
            padding: "20px 22px",
            boxShadow: "var(--shadow-airbnb-subtle)",
          }}
        >
          <p style={{ font: "600 16px/1.3 var(--font-sans)", color: "var(--corallo-testo)", margin: 0, maxWidth: 135, position: "relative", zIndex: 2 }}>
            Un piano che segue i tuoi allenamenti.
          </p>
          <Illustration name="corsa" width={130} height={145} right={8} bottom={0} active={animate} delayMs={900} priority />
        </div>
      </SlideUp>

      <SlideUp active={animate} delayMs={500} style={{ marginTop: 16, paddingBottom: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <PrimaryButton data-track="home.connect-garmin" sheen onClick={() => router.push("/connect-garmin")}>
          <WatchIcon className="action-symbol" aria-hidden="true" />Usa il calendario Garmin
        </PrimaryButton>
        <p style={{ font: "500 12px/1.5 var(--font-sans)", color: "var(--inchiostro-50)", margin: 0 }}>
          Collega Garmin per leggere calendario e attività. Un piano attivo viene inviato a Garmin Connect fino a 28 giorni; l&apos;orologio si sincronizza separatamente.
        </p>
        <button type="button" className="ux-button" data-track="home.create-ai" onClick={() => router.push("/week/programs/new?source=ai")}><SparklesIcon className="action-symbol" aria-hidden="true" />Crea un piano con AI</button>
        <button type="button" className="ux-button" data-track="home.import-file" onClick={() => router.push("/week/programs/new?source=import")}><UploadIcon className="action-symbol" aria-hidden="true" />Importa un file YAML/YML</button>
        <p style={{ font: "500 12px/1.5 var(--font-sans)", color: "var(--inchiostro-50)", margin: 0 }}>
          Puoi creare o importare una bozza senza collegare Garmin.
        </p>
      </SlideUp>
    </div>
  );
}
