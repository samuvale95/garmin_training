"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BrandMark } from "@/components/motion/BrandMark";
import { PageHeader } from "@/components/PageHeader";
import { PrimaryButton, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useParsePlanFile, useParsePlanText, usePlanQuery, useSetPlan } from "@/lib/queries";
import { downloadEnrichedPlanYaml } from "@/lib/planYaml";
import { ApiError } from "@/lib/apiClient";
import { isoWeekNumber } from "@/lib/sessionVisuals";
import { useScreenReady } from "@/lib/useScreenReady";

function daysAgo(isoDate: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86_400_000);
  if (days <= 0) return "oggi";
  if (days === 1) return "ieri";
  return `${days} giorni fa`;
}

function weeksSpanned(sessions: { date: string }[]): number {
  const keys = new Set(sessions.map((s) => `${new Date(s.date).getFullYear()}-${isoWeekNumber(new Date(s.date))}`));
  return keys.size;
}

export default function ImportPlanPage() {
  useScreenReady(true);
  const router = useRouter();
  const animate = useMountOnce("import");
  const { data: plan } = usePlanQuery();
  const setPlan = useSetPlan();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pastedText, setPastedText] = useState("");
  const [importMode, setImportMode] = useState<"replace" | "merge" | "new_plan">("replace");
  const [planName, setPlanName] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  const parseFile = useParsePlanFile();
  const parseText = useParsePlanText();
  const pending = parseFile.isPending || parseText.isPending;

  // Both paths below end at /diff, and a `router.push` doesn't prefetch on its own --
  // so fetch that route now, while the user is still choosing a file.
  useEffect(() => {
    router.prefetch("/diff");
  }, [router]);

  async function acceptFile(file: File) {
    setErrors([]);
    try {
      const text = await file.text();
      const result = await parseFile.mutateAsync(file);
      const name = importMode === "new_plan" ? (planName.trim() || file.name.replace(/\.ya?ml$/i, "")) : undefined;
      setPlan({
        yamlText: text,
        sessions: result.sessions,
        goal: result.goal,
        filename: file.name,
        importedAt: new Date().toISOString(),
        mode: importMode,
        planName: name,
      });
      router.push("/diff");
    } catch (err) {
      setErrors(err instanceof ApiError ? (err.details.length ? err.details : [err.message]) : ["Errore inatteso durante l'importazione."]);
    }
  }

  async function acceptPastedText() {
    setErrors([]);
    try {
      const result = await parseText.mutateAsync(pastedText);
      const name = importMode === "new_plan" ? (planName.trim() || "Piano importato") : undefined;
      setPlan({
        yamlText: pastedText,
        sessions: result.sessions,
        goal: result.goal,
        filename: "piano incollato",
        importedAt: new Date().toISOString(),
        mode: importMode,
        planName: name,
      });
      router.push("/diff");
    } catch (err) {
      setErrors(err instanceof ApiError ? (err.details.length ? err.details : [err.message]) : ["Errore inatteso durante l'importazione."]);
    }
  }

  return (
    <div style={{ padding: "24px 22px 32px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <PageHeader />
          <BrandMark height={24} />
        </div>
        <span style={{ fontSize: 12, color: "var(--inchiostro-50)", fontWeight: 500 }}>Piano</span>
      </div>

      <div style={{ marginTop: 20 }}>
        <WordIn active={animate} style={{ font: "600 34px/1.04 var(--font-sans)", letterSpacing: "-.035em" }}>
          Portami il file
        </WordIn>
      </div>
      <SlideUp active={animate} delayMs={100} className="font-serif-italic" style={{ fontSize: 17, color: "var(--inchiostro-70)", maxWidth: 280 }}>
        YAML, come lo scrivi tu. Non lo cambio.
      </SlideUp>

      {plan && (
        <SlideUp active={animate} delayMs={150} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 16 }}>
          <p style={{ fontSize: 13.5, fontWeight: 600, margin: "0 0 4px" }}>
            Vuoi creare un nuovo piano con l&apos;AI o all&apos;esterno?
          </p>
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-70)", margin: "0 0 10px", lineHeight: 1.4 }}>
            Scarica il piano attuale arricchito con carichi acuti/cronici, ACWR e le metriche delle sedute già svolte.
          </p>
          <button
            type="button"
            className="press-soft"
            onClick={() => downloadEnrichedPlanYaml()}
            style={{
              background: "var(--sabbia-chip)",
              color: "var(--inchiostro)",
              border: "1px solid var(--bordo-soft)",
              borderRadius: "var(--radius-pill)",
              padding: "7px 14px",
              fontSize: 12.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Scarica piano con storico e carichi (.yaml)
          </button>
        </SlideUp>
      )}

      <SlideUp
        active={animate}
        delayMs={200}
        style={{ background: "var(--inchiostro)", borderRadius: "var(--radius-card-lg)", padding: 22, color: "var(--crema)", marginTop: 20 }}
      >
        {/* Modalità di import */}
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 8px", color: "var(--crema)" }}>
            Come importare questo piano:
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { id: "replace", label: "Sostituisci attivo" },
              { id: "merge", label: "Unisci a quello attivo" },
              { id: "new_plan", label: "Crea come piano separato" },
            ].map((m) => {
              const active = importMode === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setImportMode(m.id as "replace" | "merge" | "new_plan")}
                  style={{
                    fontSize: 12,
                    padding: "5px 10px",
                    borderRadius: "var(--radius-pill)",
                    border: active ? "1.5px solid var(--crema)" : "1px solid rgba(246,238,218,.2)",
                    background: active ? "rgba(246,238,218,.25)" : "transparent",
                    color: "var(--crema)",
                    cursor: "pointer",
                  }}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
          {importMode === "new_plan" && (
            <div style={{ marginTop: 10 }}>
              <input
                type="text"
                placeholder="Nome del nuovo piano (es. Piano Corsa Primavera)"
                value={planName}
                onChange={(e) => setPlanName(e.target.value)}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  background: "rgba(246,238,218,.06)",
                  border: "1px solid rgba(246,238,218,.2)",
                  borderRadius: 8,
                  padding: "7px 10px",
                  color: "var(--crema)",
                  fontSize: 12.5,
                }}
              />
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".yaml,.yml,text/yaml"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) acceptFile(file);
          }}
        />
        <Row
          icon="⬆"
          label="Scegli un file"
          detail=".yaml o .yml dal telefono"
          onClick={() => fileInputRef.current?.click()}
          spin={false}
        />
        <div style={{ height: 1, background: "rgba(246,238,218,.14)", margin: "14px 0" }} />
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, margin: "0 0 2px" }}>Incolla il testo</p>
          <p style={{ fontSize: 12, color: "rgba(246,238,218,.6)", margin: "0 0 8px" }}>se te lo sei copiato da altrove</p>
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={6}
            placeholder={"sessions:\n  - date: \"2026-08-05\"\n    sport: running\n    title: Corsa facile"}
            style={{
              width: "100%",
              background: "rgba(246,238,218,.06)",
              border: "1px solid rgba(246,238,218,.14)",
              borderRadius: 12,
              color: "var(--crema)",
              fontFamily: "var(--font-dm-mono)",
              fontSize: 12,
              padding: 10,
              resize: "vertical",
            }}
          />
          <div style={{ marginTop: 10 }}>
            <PrimaryButton data-track="import.acceptpastedtext"
              state={pending ? "loading" : pastedText.trim() ? "idle" : "disabled"}
              onClick={acceptPastedText}
              background="var(--corallo)"
              textColor="var(--corallo-testo)"
            >
              Importa il testo incollato
            </PrimaryButton>
          </div>
        </div>
      </SlideUp>

      {errors.length > 0 && (
        <div style={{ background: "var(--rosa-avviso)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600, color: "var(--rosso-testo)", fontSize: 13 }}>
            Il file ha qualche problema:
          </p>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--rosso-testo)", fontSize: 12 }}>
            {errors.map((e, i) => (
              <li key={i} style={{ marginBottom: 4 }}>{e}</li>
            ))}
          </ul>
        </div>
      )}

      {plan && (
        <SlideUp active={animate} delayMs={300} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <p style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: ".08em" }}>
              Ultimo importato
            </p>
            {plan.importedAt && (
              <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)" }}>{daysAgo(plan.importedAt)}</span>
            )}
          </div>
          <p style={{ fontSize: 15, fontWeight: 600, margin: "0 0 4px" }}>{plan.filename}</p>
          <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>
            {weeksSpanned(plan.sessions)} settimane · {plan.sessions.length} sessioni
          </p>
        </SlideUp>
      )}

      <SlideUp
        active={animate}
        delayMs={400}
        style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 16 }}
      >
        <p style={{ fontWeight: 600, margin: "0 0 8px", fontSize: 14 }}>Come lo leggo</p>
        <pre className="font-mono" style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap" }}>
{`data · tipo · titolo
  step: durata / distanza / passo
  note libere`}
        </pre>
        <p className="font-serif-italic" style={{ fontSize: 13, margin: "10px 0 0" }}>
          Se un campo non torna te lo dico riga per riga, non butto tutto.
        </p>
      </SlideUp>

      <p style={{ textAlign: "center", fontSize: 12, color: "var(--inchiostro-35)", marginTop: 20 }}>
        Niente viene scritto su Garmin prima che tu veda cosa cambia.
      </p>
    </div>
  );
}

function Row({ icon, label, detail, onClick, spin }: { icon: string; label: string; detail?: string; onClick: () => void; spin: boolean }) {
  return (
    <button data-track="import.onclick"
      type="button"
      onClick={onClick}
      className="tap-target"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 13,
        width: "100%",
        background: "none",
        border: "none",
        color: "inherit",
        cursor: "pointer",
        padding: "3px 0",
        textAlign: "left",
      }}
    >
      <span
        className={spin ? "anim-spin-slow" : "anim-arrow-up"}
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: "rgba(246,238,218,.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          flex: "none",
        }}
      >
        {icon}
      </span>
      <span>
        <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>{label}</span>
        {detail && <span style={{ display: "block", fontSize: 12, color: "rgba(246,238,218,.6)", marginTop: 2 }}>{detail}</span>}
      </span>
    </button>
  );
}
