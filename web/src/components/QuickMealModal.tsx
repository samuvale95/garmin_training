"use client";

import { useState, useRef, useEffect, type ChangeEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CloseIcon, PlusIcon } from "@/components/Icons";
import { PortionPicker } from "@/components/FuelCorrectionSheet";
import { useAddManualEntry, useDescribeMeal, useLogPhoto, useAthleteLevel } from "@/lib/queries";
import { toDateKey } from "@/lib/sessionVisuals";

interface QuickMealModalProps {
  isOpen: boolean;
  onClose: () => void;
  todayDateKey?: string;
  defaultMealName?: string;
  defaultCarbGrams?: number;
}

const COMMON_RUNNER_SNACKS = [
  { name: "Banana media", carbs: 27, protein: 1, fat: 0, kcal: 105, portion: "1 pz (120g)" },
  { name: "Barretta energetica", carbs: 35, protein: 5, fat: 4, kcal: 196, portion: "1 barretta (50g)" },
  { name: "Gel energetico", carbs: 25, protein: 0, fat: 0, kcal: 100, portion: "1 bustina (40g)" },
  { name: "Pane e marmellata", carbs: 38, protein: 4, fat: 1, kcal: 180, portion: "2 fette (70g)" },
  { name: "Biscotti secchi (4pz)", carbs: 24, protein: 3, fat: 4, kcal: 144, portion: "4 biscotti (30g)" },
  { name: "Datteri (3pz)", carbs: 30, protein: 1, fat: 0, kcal: 125, portion: "3 datteri (45g)" },
];

export function QuickMealModal({
  isOpen,
  onClose,
  todayDateKey,
  defaultMealName,
  defaultCarbGrams,
}: QuickMealModalProps) {
  const dateKey = todayDateKey ?? toDateKey(new Date());
  const [mode, setMode] = useState<"preset" | "text" | "photo">("preset");
  const [textInput, setTextInput] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<typeof COMMON_RUNNER_SNACKS[0] | null>(null);
  const [portion, setPortion] = useState<number>(1.0);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const addManual = useAddManualEntry();
  const describeMeal = useDescribeMeal();
  const logPhoto = useLogPhoto();
  const athleteLevel = useAthleteLevel();

  // Reset when opened
  useEffect(() => {
    if (isOpen) {
      setMode("preset");
      setTextInput("");
      setSelectedPreset(null);
      setPortion(1.0);
      setSaving(false);
      setSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSelectPreset = (preset: typeof COMMON_RUNNER_SNACKS[0]) => {
    setSelectedPreset(preset);
    setPortion(1.0);
  };

  const handleSavePreset = async () => {
    if (!selectedPreset) return;
    setSaving(true);
    try {
      const carbs = Math.round(selectedPreset.carbs * portion);
      const protein = Math.round(selectedPreset.protein * portion);
      const fat = Math.round(selectedPreset.fat * portion);
      const kcal = Math.round(selectedPreset.kcal * portion);
      const desc = `${selectedPreset.name} (${portion === 1 ? selectedPreset.portion : `${portion.toString().replace(".", ",")}x ${selectedPreset.portion}`})`;

      await addManual.mutateAsync({
        date: dateKey,
        description: desc,
        carb_g: carbs,
        protein_g: protein,
        fat_g: fat,
        kcal: kcal,
      });

      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error("Errore salvataggio snack:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveText = async () => {
    const query = textInput.trim();
    if (!query) return;
    setSaving(true);
    try {
      await describeMeal.mutateAsync({ text: query, date: dateKey });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error("Errore stima testo:", err);
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    try {
      await logPhoto.mutateAsync({ file, date: dateKey });
      setSuccess(true);
      setTimeout(() => {
        onClose();
      }, 700);
    } catch (err) {
      console.error("Errore analisi foto:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1000,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
          background: "rgba(18, 16, 14, 0.45)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      >
        <motion.div
          initial={{ y: "100%", opacity: 0.5 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 28, stiffness: 350 }}
          onClick={(e) => e.stopPropagation()}
          style={{
            width: "100%",
            maxWidth: 480,
            background: "var(--crema-card)",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: "20px 20px 32px",
            boxShadow: "0 -8px 30px rgba(0,0,0,0.18)",
            borderTop: "var(--border-airbnb)",
            boxSizing: "border-box",
            maxHeight: "90vh",
            overflowY: "auto",
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <p className="font-mono" style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
                1-tap quick log
              </p>
              <h2 style={{ font: "600 20px/1.2 var(--font-sans)", margin: "4px 0 0" }}>Registra Pasto o Snack</h2>
            </div>
            <button
              onClick={onClose}
              className="tap-target"
              style={{
                background: "var(--sabbia)",
                border: "none",
                borderRadius: "50%",
                width: 32,
                height: 32,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                color: "var(--inchiostro-70)",
              }}
            >
              <CloseIcon size={14} />
            </button>
          </div>

          {/* Mode Switcher */}
          <div style={{ display: "flex", background: "var(--sabbia)", padding: 3, borderRadius: 14, marginBottom: 18 }}>
            <button
              onClick={() => { setMode("preset"); setSelectedPreset(null); }}
              style={{
                flex: 1,
                border: "none",
                background: mode === "preset" ? "var(--crema-card)" : "transparent",
                color: mode === "preset" ? "var(--inchiostro)" : "var(--inchiostro-50)",
                fontWeight: mode === "preset" ? 600 : 500,
                fontSize: 13,
                padding: "8px 0",
                borderRadius: 11,
                cursor: "pointer",
                boxShadow: mode === "preset" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              ⚡ Rapidi da Corsa
            </button>
            <button
              onClick={() => setMode("text")}
              style={{
                flex: 1,
                border: "none",
                background: mode === "text" ? "var(--crema-card)" : "transparent",
                color: mode === "text" ? "var(--inchiostro)" : "var(--inchiostro-50)",
                fontWeight: mode === "text" ? 600 : 500,
                fontSize: 13,
                padding: "8px 0",
                borderRadius: 11,
                cursor: "pointer",
                boxShadow: mode === "text" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              ✍️ Scrivi
            </button>
            <button
              onClick={() => {
                setMode("photo");
                fileInputRef.current?.click();
              }}
              style={{
                flex: 1,
                border: "none",
                background: mode === "photo" ? "var(--crema-card)" : "transparent",
                color: mode === "photo" ? "var(--inchiostro)" : "var(--inchiostro-50)",
                fontWeight: mode === "photo" ? 600 : 500,
                fontSize: 13,
                padding: "8px 0",
                borderRadius: 11,
                cursor: "pointer",
                boxShadow: mode === "photo" ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              📸 Foto
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={handlePhotoSelect}
          />

          {/* Mode 1: Presets for Runners */}
          {mode === "preset" && (
            <div>
              {!selectedPreset ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  {COMMON_RUNNER_SNACKS.map((snack) => (
                    <motion.button
                      key={snack.name}
                      whileTap={{ scale: 0.96 }}
                      onClick={() => handleSelectPreset(snack)}
                      style={{
                        background: "var(--crema-bg)",
                        border: "var(--border-airbnb)",
                        borderRadius: 16,
                        padding: "12px 14px",
                        textAlign: "left",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span style={{ font: "600 13.5px var(--font-sans)", color: "var(--inchiostro)" }}>
                        {snack.name}
                      </span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="font-mono" style={{ fontSize: 11, color: "var(--corallo)", fontWeight: 600 }}>
                          {snack.carbs}g carbo
                        </span>
                        <span className="font-mono" style={{ fontSize: 10.5, color: "var(--inchiostro-50)" }}>
                          {snack.kcal} kcal
                        </span>
                      </div>
                    </motion.button>
                  ))}
                </div>
              ) : (
                <div style={{ background: "var(--crema-bg)", borderRadius: 18, padding: 16, border: "var(--border-airbnb)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                    <div>
                      <p style={{ font: "600 16px var(--font-sans)", margin: 0 }}>{selectedPreset.name}</p>
                      <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: "2px 0 0" }}>
                        Base: {selectedPreset.portion}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedPreset(null)}
                      style={{
                        background: "none",
                        border: "none",
                        fontSize: 12.5,
                        color: "var(--inchiostro-70)",
                        textDecoration: "underline",
                        cursor: "pointer",
                      }}
                    >
                      Cambia snack
                    </button>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "14px 0" }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>Porzione:</span>
                    <PortionPicker value={portion} onChange={setPortion} />
                  </div>

                  {(() => {
                    const carbs = Math.round(selectedPreset.carbs * portion);
                    const protein = Math.round(selectedPreset.protein * portion);
                    const kcal = Math.round(selectedPreset.kcal * portion);
                    return (
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-around",
                          background: "var(--crema-card)",
                          borderRadius: 14,
                          padding: "10px 8px",
                          marginBottom: 16,
                          border: "var(--border-airbnb)",
                        }}
                      >
                        <div style={{ textAlign: "center" }}>
                          <span className="font-mono" style={{ fontSize: 15, fontWeight: 700, color: "var(--corallo)" }}>
                            {carbs}g
                          </span>
                          <span style={{ display: "block", fontSize: 10, color: "var(--inchiostro-50)" }}>Carbo</span>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <span className="font-mono" style={{ fontSize: 15, fontWeight: 600 }}>
                            {protein}g
                          </span>
                          <span style={{ display: "block", fontSize: 10, color: "var(--inchiostro-50)" }}>Proteine</span>
                        </div>
                        <div style={{ textAlign: "center" }}>
                          <span className="font-mono" style={{ fontSize: 15, fontWeight: 600 }}>
                            {kcal}
                          </span>
                          <span style={{ display: "block", fontSize: 10, color: "var(--inchiostro-50)" }}>kcal</span>
                        </div>
                      </div>
                    );
                  })()}

                  <button
                    disabled={saving || success}
                    onClick={handleSavePreset}
                    style={{
                      width: "100%",
                      padding: 13,
                      background: success ? "var(--verde)" : "var(--corallo)",
                      color: success ? "var(--verde-testo)" : "var(--corallo-testo)",
                      border: "none",
                      borderRadius: 14,
                      fontWeight: 600,
                      fontSize: 14.5,
                      cursor: "pointer",
                      boxShadow: "0 3px 12px rgba(255, 111, 89, 0.25)",
                    }}
                  >
                    {success ? "✓ Registrato con successo!" : saving ? "Salvataggio..." : "Salva Spuntino"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Free Text Description */}
          {mode === "text" && (
            <div>
              <p style={{ fontSize: 13, color: "var(--inchiostro-70)", margin: "0 0 10px" }}>
                Descrivi cosa hai mangiato (es. <em>&quot;1 piatto di pasta al pomodoro e 1 mela&quot;</em>):
              </p>
              <textarea
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder="Es. Porridge d'avena con banana e miele..."
                rows={3}
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  borderRadius: 14,
                  border: "var(--border-airbnb)",
                  padding: 12,
                  fontSize: 14,
                  background: "var(--crema-bg)",
                  fontFamily: "var(--font-sans)",
                  resize: "none",
                  outline: "none",
                  marginBottom: 12,
                }}
              />
              <button
                disabled={saving || success || !textInput.trim()}
                onClick={handleSaveText}
                style={{
                  width: "100%",
                  padding: 13,
                  background: success ? "var(--verde)" : "var(--inchiostro)",
                  color: success ? "var(--verde-testo)" : "var(--crema)",
                  border: "none",
                  borderRadius: 14,
                  fontWeight: 600,
                  fontSize: 14.5,
                  cursor: "pointer",
                  opacity: !textInput.trim() ? 0.5 : 1,
                }}
              >
                {success ? "✓ Registrato!" : saving ? "Analisi AI del pasto..." : "Registra pasto con AI"}
              </button>
            </div>
          )}

          {/* Mode 3: Photo Mode Fallback */}
          {mode === "photo" && (
            <div style={{ textAlign: "center", padding: "18px 0" }}>
              <p style={{ fontSize: 14, color: "var(--inchiostro-70)", margin: "0 0 14px" }}>
                Scatta o seleziona una foto del piatto per la stima automatica.
              </p>
              <button
                disabled={saving || success}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "12px 24px",
                  background: "var(--corallo)",
                  color: "var(--corallo-testo)",
                  border: "none",
                  borderRadius: 14,
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: "pointer",
                }}
              >
                {saving ? "Caricamento foto..." : "📸 Apri Fotocamera / Galleria"}
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
