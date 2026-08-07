"use client";

import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SlideUp, WordIn } from "@/components/motion/primitives";
import { useMountOnce } from "@/lib/motion";
import { useBodyMetrics } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";

function ageFromBirthDate(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  const age = today.getFullYear() - birth.getFullYear();
  const beforeBirthday = today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate());
  return beforeBirthday ? age - 1 : age;
}

function formatDay(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("it-IT", { day: "numeric", month: "long" });
}

function formatWeight(kg: number): string {
  return kg.toFixed(1).replace(".", ",");
}

interface EffectiveWeight {
  weightKg: number;
  source: "scale" | "profile" | "manual";
  label: string;
}

export default function BodySettingsPage() {
  const animate = useMountOnce("settings-body");
  const { data: metrics, isLoading } = useBodyMetrics();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const setManualWeight = usePassoStore((s) => s.setManualWeight);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const effective: EffectiveWeight | null = manualWeight
    ? { weightKg: manualWeight.weightKg, source: "manual", label: "inserito da te" }
    : metrics?.weight_kg != null && metrics.source
      ? {
          weightKg: metrics.weight_kg,
          source: metrics.source,
          label:
            metrics.source === "scale"
              ? `dalla bilancia Garmin${metrics.measured_on ? ` · ${formatDay(metrics.measured_on)}` : ""}`
              : "dal profilo Garmin",
        }
      : null;

  const age = metrics?.birth_date ? ageFromBirthDate(metrics.birth_date) : null;
  const hasProfileDetail = metrics?.height_cm != null || age != null;

  function startEdit() {
    setDraft(effective ? formatWeight(effective.weightKg) : "");
    setEditing(true);
  }

  function save() {
    const parsed = Number(draft.replace(",", "."));
    if (Number.isFinite(parsed) && parsed > 0) setManualWeight(parsed);
    setEditing(false);
  }

  const weightInputStyle: React.CSSProperties = {
    flex: 1,
    fontSize: 26,
    fontWeight: 500,
    border: "none",
    background: "var(--sabbia)",
    borderRadius: "var(--radius-chip)",
    padding: "12px 16px",
    outline: "none",
    color: "var(--inchiostro)",
  };

  return (
    <div style={{ padding: "24px 22px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/settings" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>impostazioni</span>
      </div>

      <WordIn active={animate} as="h1" style={{ font: "600 30px/1.06 var(--font-outfit)", letterSpacing: "-.03em", margin: "16px 0 16px" }}>
        Il tuo corpo
      </WordIn>

      {isLoading ? (
        <p>Carico i dati…</p>
      ) : effective ? (
        <SlideUp active={animate} delayMs={100} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
            <p style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: 0 }}>peso</p>
            {!editing && (
              <button
                type="button"
                onClick={startEdit}
                className="tap-target"
                style={{ display: "flex", alignItems: "center", gap: 6, background: "var(--sabbia-chip)", border: "none", borderRadius: "var(--radius-pill)", padding: "8px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >
                <span aria-hidden="true">✏️</span> modifica
              </button>
            )}
          </div>

          {editing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <input
                autoFocus
                inputMode="decimal"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                placeholder="68,0"
                className="font-mono"
                style={{ ...weightInputStyle, fontSize: 32 }}
              />
              <button
                type="button"
                onClick={save}
                className="tap-target"
                style={{ background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "14px 22px", fontSize: 15, fontWeight: 600, cursor: "pointer" }}
              >
                Salva
              </button>
            </div>
          ) : (
            <button type="button" onClick={startEdit} style={{ display: "block", background: "none", border: "none", padding: 0, marginTop: 4, textAlign: "left", cursor: "pointer" }}>
              <span className="font-mono" style={{ fontSize: 40, fontWeight: 500, color: "var(--inchiostro)" }}>
                {formatWeight(effective.weightKg)}
              </span>
              <span style={{ fontSize: 15, marginLeft: 6, color: "var(--inchiostro-50)" }}>kg</span>
            </button>
          )}

          <p style={{ fontSize: 12.5, color: "var(--inchiostro-35)", marginTop: 8 }}>{effective.label}</p>

          {hasProfileDetail && (
            <>
              <div style={{ height: 1, background: "var(--sabbia-bordo)", margin: "16px 0" }} />
              <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
                {metrics?.height_cm != null && (
                  <div>
                    <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 2px" }}>altezza</p>
                    <p className="font-mono" style={{ fontSize: 17, margin: 0 }}>
                      {metrics.height_cm} <span style={{ fontSize: 12 }}>cm</span>
                    </p>
                  </div>
                )}
                {age != null && (
                  <div>
                    <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 2px" }}>età</p>
                    <p className="font-mono" style={{ fontSize: 17, margin: 0 }}>{age}</p>
                  </div>
                )}
                <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--inchiostro-50)" }}>dal profilo Garmin</span>
              </div>
            </>
          )}
        </SlideUp>
      ) : (
        <SlideUp active={animate} delayMs={100} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 20 }}>
          <p style={{ fontWeight: 700, fontSize: 17, margin: "0 0 6px" }}>Non ho il tuo peso</p>
          <p style={{ fontSize: 13.5, color: "var(--inchiostro-50)", margin: "0 0 16px" }}>
            Garmin non me lo passa. Serve per calcolare quanti carboidrati ti servono: senza, uso 70 kg di riferimento.
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <input
              inputMode="decimal"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              placeholder="68,0"
              className="font-mono"
              style={{ ...weightInputStyle, color: draft ? "var(--inchiostro)" : "var(--inchiostro-35)" }}
            />
            <button
              type="button"
              onClick={save}
              disabled={!draft}
              className="tap-target"
              style={{ background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 24px", fontSize: 15, fontWeight: 600, cursor: draft ? "pointer" : "default", opacity: draft ? 1 : 0.5 }}
            >
              Salva
            </button>
          </div>
        </SlideUp>
      )}

      {!effective && (
        <SlideUp active={animate} delayMs={180} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
          <p className="font-serif-italic" style={{ fontSize: 14.5, color: "var(--inchiostro-70)", margin: 0 }}>
            Puoi anche non dirmelo. Continuo a lavorare con dei range di riferimento, te lo scrivo ogni volta che lo faccio.
          </p>
        </SlideUp>
      )}

      {!effective && hasProfileDetail && (
        <SlideUp active={animate} delayMs={260} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12, display: "flex", alignItems: "flex-end", gap: 24 }}>
          {metrics?.height_cm != null && (
            <div>
              <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 2px" }}>altezza</p>
              <p className="font-mono" style={{ fontSize: 17, margin: 0 }}>
                {metrics.height_cm} <span style={{ fontSize: 12 }}>cm</span>
              </p>
            </div>
          )}
          {age != null && (
            <div>
              <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 2px" }}>età</p>
              <p className="font-mono" style={{ fontSize: 17, margin: 0 }}>{age}</p>
            </div>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--inchiostro-50)" }}>dal profilo Garmin</span>
        </SlideUp>
      )}

      {effective && (
        <SlideUp active={animate} delayMs={220} style={{ background: "var(--azzurro)", color: "var(--azzurro-testo)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
          <p style={{ fontWeight: 700, margin: "0 0 8px" }}>A cosa serve il peso</p>
          <p className="font-serif-italic" style={{ fontSize: 14.5, margin: 0 }}>
            Solo a calcolare quanti carboidrati ti servono nei giorni duri. Non lo confronto con niente e non lo metto in un grafico.
          </p>
        </SlideUp>
      )}

      {effective && (
        <SlideUp active={animate} delayMs={280} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 18, marginTop: 12 }}>
          <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 4px" }}>Il valore che scrivi tu vince</p>
          <p style={{ fontSize: 13, color: "var(--inchiostro-50)", margin: 0 }}>finché non lo cancelli, ignoro quello di Garmin</p>
        </SlideUp>
      )}

      {effective?.source === "manual" && (
        <button
          type="button"
          onClick={() => setManualWeight(null)}
          className="tap-target"
          style={{ display: "block", margin: "20px auto 0", background: "none", border: "none", color: "var(--inchiostro-50)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Torna a usare il peso di Garmin
        </button>
      )}
    </div>
  );
}
