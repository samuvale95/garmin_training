"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { Illustration } from "@/components/Illustration";
import { PrimaryButton, WordIn, SlideUp } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { usePassoStore } from "@/lib/store";

export default function EntryPage() {
  const router = useRouter();
  const plan = usePassoStore((s) => s.plan);
  const animate = useMountOnce("entry");

  // A device that already has a plan skips the welcome screen entirely -- there is
  // no account to "log into," so there is nothing to gate a returning visit on.
  useEffect(() => {
    if (plan) router.replace("/today");
  }, [plan, router]);

  if (plan) return null;

  return (
    <div style={{ padding: "30px 22px 0", display: "flex", flexDirection: "column", minHeight: "100dvh" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <BrandMark height={26} />
        <span style={{ fontSize: 18, fontWeight: 600 }}>Passo</span>
      </div>

      <div style={{ marginTop: 32 }}>
        <WordIn active={animate} delayMs={0} style={{ font: "600 40px/1 var(--font-outfit)", letterSpacing: "-.04em" }}>
          Il piano
        </WordIn>
        <WordIn active={animate} delayMs={100} style={{ font: "600 40px/1.06 var(--font-outfit)", letterSpacing: "-.04em" }}>
          scritto una
        </WordIn>
        <WordIn active={animate} delayMs={200} style={{ font: "600 40px/1.06 var(--font-outfit)", letterSpacing: "-.04em", color: "var(--corallo)" }}>
          volta sola
        </WordIn>
      </div>

      <SlideUp active={animate} delayMs={300} className="font-serif-italic" style={{ fontSize: 18, color: "var(--inchiostro-70)", marginTop: 16, maxWidth: 280 }}>
        Tu tieni il file. Io lo porto sull&apos;orologio e ti dico quando il corpo non è d&apos;accordo.
      </SlideUp>

      <SlideUp active={animate} delayMs={400} style={{ position: "relative", height: 250, marginTop: 22, flex: 1 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "var(--corallo)",
            borderRadius: "var(--radius-card-lg)",
            overflow: "hidden",
          }}
        >
          <Illustration name="corsa" width={196} height={212} right={12} bottom={0} active={animate} delayMs={900} />
        </div>
      </SlideUp>

      <SlideUp active={animate} delayMs={500} style={{ paddingBottom: 22, display: "flex", flexDirection: "column", gap: 13 }}>
        <PrimaryButton sheen onClick={() => router.push("/connect-garmin")}>
          Inizia
        </PrimaryButton>
        <p style={{ font: "500 12px/1.6 var(--font-outfit)", color: "var(--inchiostro-35)", textAlign: "center", margin: 0 }}>
          Il collegamento a Garmin lo fai dopo, quando importi il primo piano.
        </p>
      </SlideUp>
    </div>
  );
}
