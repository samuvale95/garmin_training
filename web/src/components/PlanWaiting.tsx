"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ILLUSTRATION_SOURCES } from "@/components/Illustration";
import { useMotionEnabled } from "@/lib/motion";

/** The three sports take turns while the plan is written, each moving its own way. */
const SCENES = [
  { name: "corsa", motion: "gen-run", ground: true },
  { name: "bici", motion: "gen-ride", ground: true },
  { name: "forza", motion: "gen-lift", ground: false },
] as const;
const SCENE_MS = 3200;

/** What the server is doing, by elapsed time. Not progress reported by the server -- the
 * call is one request -- but the order is real and the timings are the usual ones: the
 * limits take a second or two, the model most of the wait, a retry the rest. */
const PHASES: [number, string][] = [
  [0, "Leggo il tuo storico"],
  [3, "Calcolo i limiti del tuo livello"],
  [7, "L'AI compone le sedute"],
  [35, "Controllo ogni seduta sui limiti, e se serve la faccio correggere"],
  [120, "Ci sto mettendo più del solito, ma sto ancora lavorando"],
];

function phaseAt(seconds: number): string {
  let text = PHASES[0][1];
  for (const [from, label] of PHASES) if (seconds >= from) text = label;
  return text;
}

function elapsedLabel(seconds: number): string {
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

/** The wait for `POST /plan/generate`. `startedAt` is the mutation's own submit time, so
 * the clock keeps its place when the card is left and come back to. */
export function PlanWaiting({ startedAt }: { startedAt: number }) {
  const { reduced } = useMotionEnabled();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const scene = SCENES[Math.floor((now - startedAt) / SCENE_MS) % SCENES.length];

  return (
    <div role="status" aria-live="polite" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: 150, height: 132, overflow: "hidden" }} aria-hidden="true">
        <div key={scene.name} className={reduced ? undefined : "gen-swap"} style={{ position: "absolute", inset: "0 0 10px 0" }}>
          <div className={reduced ? undefined : scene.motion} style={{ position: "relative", width: "100%", height: "100%" }}>
            <Image
              src={ILLUSTRATION_SOURCES[scene.name]}
              alt=""
              fill
              sizes="150px"
              style={{ objectFit: "contain", objectPosition: "bottom" }}
            />
          </div>
        </div>
        {/* The road going by: dashes that scroll under the two sports that travel. */}
        <div
          className={!reduced && scene.ground ? "gen-ground" : undefined}
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 4,
            height: 2,
            opacity: scene.ground ? 0.5 : 0,
            transition: "opacity 300ms var(--ease)",
            backgroundImage: "linear-gradient(90deg, var(--inchiostro-35) 0 22px, transparent 22px 48px)",
            backgroundSize: "48px 2px",
          }}
        />
      </div>
      <p className="font-serif-italic" style={{ fontSize: 14, margin: 0, textAlign: "center" }}>
        {phaseAt(seconds)}…
      </p>
      <p className="font-mono" style={{ fontSize: 11.5, color: "var(--inchiostro-50)", margin: 0 }}>
        {elapsedLabel(seconds)} · di solito meno di un minuto
      </p>
    </div>
  );
}
