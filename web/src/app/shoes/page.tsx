"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { BarGrow, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useRetireShoe, useShoes } from "@/lib/queries";

export default function ShoesPage() {
  return (
    <Suspense fallback={null}>
      <ShoesScreen />
    </Suspense>
  );
}

function ShoesScreen() {
  const animate = useMountOnce("shoes");
  const searchParams = useSearchParams();
  const from = searchParams.get("from") ?? "/settings";
  const shoesQuery = useShoes();
  const retire = useRetireShoe();

  const shoes = shoesQuery.data?.shoes ?? [];
  const active = shoes.filter((s) => !s.retired);
  const retired = shoes.filter((s) => s.retired);

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref={from} />
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>da Strava</span>
      </div>

      <WordIn active={animate} style={{ font: "600 30px/1.06 var(--font-outfit)", letterSpacing: "-.03em", marginTop: 18 }}>
        Usura scarpe
      </WordIn>

      <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", maxWidth: 320, marginTop: 8 }}>
        Ogni km svolto va sulla scarpa che hai segnato su Strava. Sopra i 600-700 km l&apos;ammortizzazione cede prima che te ne accorga.
      </p>

      {shoesQuery.isLoading && (
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-50)", marginTop: 20 }}>Carico le scarpe da Strava...</p>
      )}

      {!shoesQuery.isLoading && shoes.length === 0 && (
        <p className="font-serif-italic" style={{ fontSize: 14, color: "var(--inchiostro-50)", marginTop: 20 }}>
          Nessuna scarpa trovata su Strava. Aggiungine una nel tuo profilo Strava per vederla qui.
        </p>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 20 }}>
        {active.map((shoe, i) => (
          <ShoeCard key={shoe.id} shoe={shoe} highlight={shoe.wear_percent >= 100} delay={i * 100} active={animate} onRetire={() => retire.mutate(shoe.id)} retiring={retire.isPending && retire.variables === shoe.id} />
        ))}
      </div>

      {retired.length > 0 && (
        <>
          <p style={{ fontSize: 11, fontWeight: 500, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--inchiostro-50)", marginTop: 26 }}>
            Archiviate
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10, opacity: 0.55 }}>
            {retired.map((shoe) => (
              <div key={shoe.id} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 14, display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{shoe.name}</span>
                <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{shoe.distance_km.toFixed(0)} km</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ShoeCard({
  shoe,
  highlight,
  delay,
  active,
  onRetire,
  retiring,
}: {
  shoe: { id: string; name: string; distance_km: number; wear_percent: number; weeks_remaining: number | null };
  highlight: boolean;
  delay: number;
  active: boolean;
  onRetire: () => void;
  retiring: boolean;
}) {
  return (
    <div style={{ background: highlight ? "var(--rosa-avviso)" : "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: highlight ? "var(--rosso-testo)" : "var(--inchiostro)" }}>{shoe.name}</span>
        <span className="font-mono" style={{ fontSize: 13, color: highlight ? "var(--rosso-avviso)" : "var(--inchiostro-50)" }}>
          {shoe.distance_km.toFixed(0)} km
        </span>
      </div>
      <div style={{ marginTop: 10 }}>
        <BarGrow value={shoe.wear_percent / 100} color={highlight ? "var(--rosso-avviso)" : "var(--corallo)"} trackColor={highlight ? "var(--corallo-chiaro)" : "var(--sabbia-chip)"} active={active} delayMs={delay} />
      </div>
      <p style={{ fontSize: 12, color: highlight ? "var(--rosso-testo)" : "var(--inchiostro-50)", margin: "8px 0 0" }}>
        {shoe.wear_percent.toFixed(0)}% dei 700 km
        {shoe.weeks_remaining != null && ` · a questo ritmo si esauriscono in ${shoe.weeks_remaining} settiman${shoe.weeks_remaining === 1 ? "a" : "e"}`}
      </p>
      <button
        type="button"
        onClick={onRetire}
        disabled={retiring}
        className="tap-target"
        style={{
          marginTop: 12,
          width: "100%",
          background: "var(--sabbia-chip)",
          border: "none",
          borderRadius: "var(--radius-pill)",
          padding: "10px 0",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--inchiostro-70)",
          cursor: retiring ? "default" : "pointer",
        }}
      >
        Segna {shoe.name} come ritirata
      </button>
    </div>
  );
}
