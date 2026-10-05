"use client";

import { dis } from "@/lib/disabled";
import { useState } from "react";
import { ChevronLeft } from "@/components/Icons";
import { PulseRing } from "@/components/motion/primitives";
import { PortionPicker, macroAtPortion } from "@/components/FuelCorrectionSheet";
import { useUpdateEntry } from "@/lib/queries";
import type { FoodEntry } from "@/lib/types";

export type Preview = { kind: "photo"; url: string } | { kind: "text"; text: string };
export type ComposeMode = "stima" | "manuale";

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button data-track="meal-flow-screens.onclick"
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        border: "none",
        background: active ? "var(--crema)" : "transparent",
        borderRadius: "var(--radius-pill)",
        padding: "8px 14px",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        color: active ? "var(--inchiostro)" : "var(--inchiostro-50)",
        cursor: "pointer",
        boxShadow: active ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
        transition: "all 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

export function ReviewMacroField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ flex: 1, background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14 }}>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 6px" }}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          placeholder="—"
          className="font-mono"
          style={{ width: "100%", border: "none", background: "none", fontSize: 24, fontWeight: 500, outline: "none", padding: 0, color: "var(--inchiostro)" }}
        />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>g</span>
      </div>
    </div>
  );
}

export function ComposeScreen({
  onCancel,
  onSubmit,
  onSaveManual,
  saving,
}: {
  onCancel: () => void;
  onSubmit: (text: string) => void;
  onSaveManual: (fields: { description: string; carb: string; protein: string; fat: string; kcal: string }) => void;
  saving: boolean;
}) {
  const [mode, setMode] = useState<ComposeMode>("stima");
  const [text, setText] = useState("");
  const [description, setDescription] = useState("");
  const [carb, setCarb] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");
  const [kcal, setKcal] = useState("");

  const ready =
    mode === "stima"
      ? text.trim().length >= 2
      : carb !== "" || protein !== "" || fat !== "" || kcal !== "";

  function submit() {
    if (!ready || saving) return;
    if (mode === "stima") onSubmit(text.trim());
    else onSaveManual({ description, carb, protein, fat, kcal });
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--crema)", padding: "22px 20px 28px", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button data-track="meal-flow-screens.indietro"
          type="button"
          onClick={onCancel}
          aria-label="Indietro"
          className="tap-target"
          style={{ background: "none", border: "none", display: "inline-flex", alignItems: "center", cursor: "pointer", color: "var(--inchiostro)", padding: 4 }}
        >
          <ChevronLeft size={20} strokeWidth={2.4} />
        </button>
        <h1 style={{ font: "600 20px/1 var(--font-sans)", letterSpacing: "-.02em", margin: 0 }}>Aggiungi un pasto</h1>
      </div>

      <div style={{ display: "flex", gap: 4, background: "var(--sabbia)", borderRadius: "var(--radius-pill)", padding: 4, marginTop: 16 }}>
        <ModeTab active={mode === "stima"} onClick={() => setMode("stima")}>
          Lo stimo io
        </ModeTab>
        <ModeTab active={mode === "manuale"} onClick={() => setMode("manuale")}>
          Scrivo i valori
        </ModeTab>
      </div>

      {mode === "stima" ? (
        <>
          <p className="font-serif-italic" style={{ fontSize: 16, lineHeight: 1.35, color: "var(--inchiostro-70)", margin: "18px 0 0" }}>
            Dimmi cosa hai mangiato, con le quantità se le sai. Ai numeri ci penso io.
          </p>

          <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 16, marginTop: 16 }}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              rows={5}
              maxLength={400}
              placeholder="80 g di pasta al pomodoro, due uova, una mela"
              style={{
                width: "100%",
                border: "none",
                background: "none",
                outline: "none",
                resize: "none",
                padding: 0,
                fontSize: 17,
                lineHeight: 1.4,
                fontFamily: "inherit",
                color: "var(--inchiostro)",
              }}
            />
            <p className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-35)", margin: "10px 0 0", textAlign: "right" }}>
              {text.length}/400
            </p>
          </div>

          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "12px 0 0", lineHeight: 1.4 }}>
            Con una quantità dichiarata la stima è molto più precisa di una foto. Senza,
            tiro a una porzione normale e te lo dico.
          </p>
        </>
      ) : (
        <>
          <p className="font-serif-italic" style={{ fontSize: 16, lineHeight: 1.35, color: "var(--inchiostro-70)", margin: "18px 0 0" }}>
            I numeri li sai già: scrivili e li tengo esattamente così.
          </p>

          <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 16 }}>
            <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 4px" }}>descrizione</p>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
              placeholder="Cos'era?"
              style={{ width: "100%", border: "none", background: "none", padding: 0, fontSize: 17, fontWeight: 600, outline: "none", color: "var(--inchiostro)" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
            <ReviewMacroField label="carboidrati" value={carb} onChange={setCarb} />
            <ReviewMacroField label="proteine" value={protein} onChange={setProtein} />
            <ReviewMacroField label="grassi" value={fat} onChange={setFat} />
          </div>

          <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>energia</span>
            <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <input
                inputMode="numeric"
                value={kcal}
                onChange={(e) => setKcal(e.target.value.replace(/\D/g, ""))}
                placeholder="—"
                className="font-mono"
                style={{ width: 70, textAlign: "right", border: "none", background: "none", fontSize: 20, fontWeight: 600, outline: "none", color: "var(--inchiostro)" }}
              />
              <span className="font-mono" style={{ fontSize: 14, color: "var(--inchiostro-50)" }}>kcal</span>
            </div>
          </div>

          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "12px 0 0", lineHeight: 1.4 }}>
            Anche uno solo dei valori va bene. Quello che scrivi tu non lo ritocco più.
          </p>
        </>
      )}

      <button data-track="meal-flow-screens.submit"
        type="button"
        onClick={submit}
        {...dis(!ready || saving, "form_incompleto_o_in_caricamento")}
        className="tap-target press-soft"
        style={{
          marginTop: "auto",
          width: "100%",
          background: ready && !saving ? "var(--inchiostro)" : "var(--sabbia-chip)",
          color: ready && !saving ? "var(--crema)" : "var(--inchiostro-35)",
          border: "none",
          borderRadius: "var(--radius-pill)",
          padding: "17px 22px",
          fontSize: 16,
          fontWeight: 600,
          cursor: ready && !saving ? "pointer" : "default",
        }}
      >
        {mode === "stima" ? "Calcola i valori" : saving ? "Salvo…" : "Salva il pasto"}
      </button>
    </div>
  );
}

function DarkSkeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number | string }) {
  return (
    <div style={{ width, height, borderRadius: 8, background: "rgba(246,238,218,.14)", position: "relative", overflow: "hidden" }}>
      <span aria-hidden="true" className="anim-sheen" style={{ position: "absolute", inset: 0, width: "50%", background: "linear-gradient(90deg, rgba(246,238,218,0), rgba(246,238,218,.28), rgba(246,238,218,0))" }} />
    </div>
  );
}

export function EstimatingScreen({ preview, onCancel }: { preview: Preview; onCancel: () => void }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "22px 20px 28px", display: "flex", flexDirection: "column" }}>
      {preview.kind === "photo" ? (
        <div style={{ position: "relative", borderRadius: "var(--radius-card-lg)", overflow: "hidden", border: "2px dashed rgba(246,238,218,.35)", aspectRatio: "1 / 1" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <div style={{ position: "absolute", bottom: 16, left: 16 }}>
            <PulseRing size={14} />
          </div>
        </div>
      ) : (
        <div style={{ position: "relative", borderRadius: "var(--radius-card-lg)", border: "2px dashed rgba(246,238,218,.35)", padding: "22px 20px 20px" }}>
          <p style={{ fontSize: 18, lineHeight: 1.4, margin: 0 }}>{preview.text}</p>
          <div style={{ marginTop: 18 }}>
            <PulseRing size={14} />
          </div>
        </div>
      )}

      <p style={{ font: "700 26px/1.15 var(--font-sans)", margin: "24px 0 0" }}>
        {preview.kind === "photo" ? (
          <>
            Sto guardando
            <br />
            il piatto
          </>
        ) : (
          <>
            Sto leggendo
            <br />
            quello che hai scritto
          </>
        )}
      </p>

      <div style={{ marginTop: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <DarkSkeleton width="70%" />
        <DarkSkeleton width="46%" />
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <DarkSkeleton height={62} />
        <DarkSkeleton height={62} />
        <DarkSkeleton height={62} />
      </div>

      <p className="font-serif-italic" style={{ fontSize: 15, opacity: 0.7, marginTop: 26 }}>
        Porzioni e condimenti sono la parte difficile: quello che esce è una stima, e la potrai correggere.
      </p>

      <button data-track="meal-flow-screens.oncancel" type="button" onClick={onCancel} className="tap-target" style={{ marginTop: "auto", alignSelf: "center", background: "none", border: "none", color: "var(--inchiostro-su-scuro)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Annulla
      </button>
    </div>
  );
}

function confidenceLabel(confidence: FoodEntry["confidence"]): string {
  return confidence === "low" ? "bassa" : confidence === "medium" ? "media" : confidence === "high" ? "alta" : "";
}

export function ReviewScreen({ entry, preview, onDiscard, onSaved }: { entry: FoodEntry; preview: Preview; onDiscard: () => void; onSaved: () => void }) {
  const updateEntry = useUpdateEntry();
  const [description, setDescription] = useState(entry.description ?? "");
  const [carb, setCarb] = useState(entry.carb_g != null ? String(Math.round(entry.carb_g)) : "");
  const [protein, setProtein] = useState(entry.protein_g != null ? String(Math.round(entry.protein_g)) : "");
  const [fat, setFat] = useState(entry.fat_g != null ? String(Math.round(entry.fat_g)) : "");
  const [kcal, setKcal] = useState(entry.kcal != null ? String(Math.round(entry.kcal)) : "");
  const [portion, setPortion] = useState(entry.portion);
  const [macrosEdited, setMacrosEdited] = useState(false);

  function edit(setter: (v: string) => void) {
    return (v: string) => {
      setMacrosEdited(true);
      setter(v);
    };
  }

  function choosePortion(next: number) {
    setCarb(macroAtPortion(entry.carb_g, entry.portion, carb, macrosEdited, portion, next));
    setProtein(macroAtPortion(entry.protein_g, entry.portion, protein, macrosEdited, portion, next));
    setFat(macroAtPortion(entry.fat_g, entry.portion, fat, macrosEdited, portion, next));
    setKcal(macroAtPortion(entry.kcal, entry.portion, kcal, macrosEdited, portion, next));
    setPortion(next);
  }

  function save() {
    const patch: Parameters<typeof updateEntry.mutate>[0] = { id: entry.id };
    if (description !== (entry.description ?? "")) patch.description = description || null;
    if (macrosEdited) {
      patch.carb_g = carb === "" ? null : Number(carb);
      patch.protein_g = protein === "" ? null : Number(protein);
      patch.fat_g = fat === "" ? null : Number(fat);
      patch.kcal = kcal === "" ? null : Number(kcal);
    }
    if (portion !== entry.portion) patch.portion = portion;
    if (Object.keys(patch).length === 1) {
      onSaved();
      return;
    }
    updateEntry.mutate(patch, { onSuccess: onSaved });
  }

  const low = entry.confidence === "low";

  return (
    <div style={{ minHeight: "100dvh", background: "var(--crema)", padding: "22px 20px 28px" }}>
      <div
        style={{
          position: "relative",
          borderRadius: "var(--radius-card-lg)",
          overflow: "hidden",
          ...(preview.kind === "photo"
            ? { aspectRatio: "1 / 1" }
            : { background: "var(--inchiostro)", color: "var(--crema)", padding: "22px 20px" }),
        }}
      >
        {preview.kind === "photo" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <>
            <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-su-scuro)", margin: 0 }}>
              hai scritto
            </p>
            <p style={{ fontSize: 17, lineHeight: 1.4, margin: "8px 0 0", paddingRight: 90 }}>{preview.text}</p>
          </>
        )}
        {entry.confidence && (
          <span
            style={{ position: "absolute", top: 14, right: 14, background: low ? "var(--rosa-avviso)" : "var(--crema-card)", color: low ? "var(--rosso-testo)" : "var(--inchiostro)", borderRadius: "var(--radius-pill)", padding: "7px 14px", fontSize: 12.5, fontWeight: 700 }}
          >
            confidenza {confidenceLabel(entry.confidence)}
          </span>
        )}
      </div>

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 14 }}>
        <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 4px" }}>descrizione</p>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ width: "100%", border: "none", background: "none", padding: 0, fontSize: 17, fontWeight: 600, outline: "none", color: "var(--inchiostro)" }}
        />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <ReviewMacroField label="carboidrati" value={carb} onChange={edit(setCarb)} />
        <ReviewMacroField label="proteine" value={protein} onChange={edit(setProtein)} />
        <ReviewMacroField label="grassi" value={fat} onChange={edit(setFat)} />
      </div>

      <div style={{ marginTop: 10 }}>
        <PortionPicker value={portion} onChange={choosePortion} disabled={updateEntry.isPending} />
      </div>

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>energia</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <input
            inputMode="numeric"
            value={kcal}
            onChange={(e) => edit(setKcal)(e.target.value.replace(/\D/g, ""))}
            className="font-mono"
            style={{ width: 70, textAlign: "right", border: "none", background: "none", fontSize: 20, fontWeight: 600, outline: "none", color: "var(--inchiostro)" }}
          />
          <span className="font-mono" style={{ fontSize: 14, color: "var(--inchiostro-50)" }}>kcal</span>
        </div>
      </div>

      {low && (
        <div style={{ background: "var(--rosa-avviso)", borderRadius: "var(--radius-card)", padding: 14, marginTop: 12 }}>
          <p style={{ fontWeight: 700, color: "var(--rosso-testo)", fontSize: 14.5, margin: "0 0 4px" }}>Non sono sicuro delle porzioni</p>
          <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--rosa-testo-50)", margin: 0 }}>Sistemale tu: tocca un numero e cambialo, tengo il tuo.</p>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button data-track="meal-flow-screens.ondiscard" type="button" onClick={onDiscard} className="tap-target" style={{ background: "var(--sabbia)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Scarta
        </button>
        <button data-track="meal-flow-screens.save" type="button" onClick={save} {...dis(updateEntry.isPending, "in_caricamento")} className="tap-target" style={{ flex: 1, background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Salva
        </button>
      </div>
    </div>
  );
}

export function FailedScreen({ entryId, preview, onRetake, onSaved }: { entryId: number; preview: Preview; onRetake: () => void; onSaved: () => void }) {
  const updateEntry = useUpdateEntry();
  const [carb, setCarb] = useState("");
  const [protein, setProtein] = useState("");
  const [fat, setFat] = useState("");

  function save() {
    const patch: { id: number; carb_g?: number; protein_g?: number; fat_g?: number } = { id: entryId };
    if (carb !== "") patch.carb_g = Number(carb);
    if (protein !== "") patch.protein_g = Number(protein);
    if (fat !== "") patch.fat_g = Number(fat);
    if (patch.carb_g == null && patch.protein_g == null && patch.fat_g == null) {
      onSaved();
      return;
    }
    updateEntry.mutate(patch, { onSuccess: onSaved });
  }

  return (
    <div style={{ minHeight: "100dvh", background: "var(--rosa-avviso)", padding: "22px 20px 28px", display: "flex", flexDirection: "column" }}>
      <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--rosso-avviso)", margin: 0 }}>Stima non riuscita</p>
      <p style={{ font: "700 30px/1.1 var(--font-sans)", color: "var(--rosso-testo)", margin: "10px 0 0" }}>
        {preview.kind === "photo" ? (
          <>
            Da questa foto
            <br />
            non ci arrivo
          </>
        ) : (
          <>
            Da questa frase
            <br />
            non ci arrivo
          </>
        )}
      </p>
      <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--rosa-testo-50)", margin: "14px 0 0" }}>
        {preview.kind === "photo"
          ? "Troppo poca luce, o il piatto è coperto. Non voglio inventarti dei numeri."
          : "Non ho capito cosa hai mangiato, o il modello non risponde. Non voglio inventarti dei numeri."}
      </p>

      <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 20 }}>
        <p style={{ fontWeight: 700, fontSize: 15, margin: "0 0 12px" }}>Scrivili tu, se li sai</p>
        <div style={{ display: "flex", gap: 10 }}>
          <ReviewMacroField label="carbo" value={carb} onChange={setCarb} />
          <ReviewMacroField label="proteine" value={protein} onChange={setProtein} />
          <ReviewMacroField label="grassi" value={fat} onChange={setFat} />
        </div>
        <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", marginTop: 12 }}>Anche uno solo dei tre va bene. Meglio un dato tuo che una foto buttata.</p>
      </div>

      <button data-track="meal-flow-screens.save-2"
        type="button"
        onClick={save}
        {...dis(updateEntry.isPending, "in_caricamento")}
        className="tap-target"
        style={{ marginTop: "auto", background: "var(--rosso-forte)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
      >
        Salva quello che ho scritto
      </button>
      <button data-track="meal-flow-screens.onretake" type="button" onClick={onRetake} className="tap-target" style={{ marginTop: 12, alignSelf: "center", background: "none", border: "none", color: "var(--rosso-testo)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        {preview.kind === "photo" ? "Rifai la foto" : "Riscrivilo"}
      </button>
    </div>
  );
}
