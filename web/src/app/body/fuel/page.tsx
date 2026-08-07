"use client";

import { useRef, useState, type ChangeEvent, type ReactNode } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { BarGrow, ProgressRing, PulseRing, SlideUp } from "@/components/motion/primitives";
import { FoodThumb, FuelCorrectionSheet } from "@/components/FuelCorrectionSheet";
import { useMountOnce } from "@/lib/motion";
import { capitalize, formatClockTime, formatFullDate, formatWeekday } from "@/lib/format";
import { useCalendarAccess } from "@/lib/guards";
import { useFoodDay, useFuelNarrative, useFuelTargets, useLogPhoto, useWorkouts, useDeleteEntry, useUpdateEntry } from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import type { DayTarget, DayTotals, FoodEntry, FuelTargets } from "@/lib/types";

// ---- flow state: idle screen (C), or one of the photo-estimate states (D) ------------------

type Flow =
  | { kind: "idle" }
  | { kind: "estimating"; previewUrl: string }
  | { kind: "review"; entry: FoodEntry; previewUrl: string }
  | { kind: "failed"; entry: FoodEntry; previewUrl: string };

// Deliberately tiny: this never leaves the meal-list icon (52px, see FoodThumb), so
// there is nothing to gain from keeping more than a phone-camera JPEG would need for
// that. Generated here, client-side, so the only photo bytes that ever reach the
// server for storage are already this small -- the full-resolution file is sent
// separately, read once for the vision estimate, and never written to disk.
const THUMBNAIL_MAX_SIDE = 160;
const THUMBNAIL_QUALITY = 0.5;

function createThumbnail(file: File): Promise<Blob | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(objectUrl);
          resolve(blob);
        },
        "image/jpeg",
        THUMBNAIL_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

export default function FuelPage() {
  const animate = useMountOnce("body-fuel");
  const access = useCalendarAccess();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const today = toDateKey(new Date());

  // No imported plan, so there is no on-device session to read tomorrow's load off --
  // fall back to what Garmin's own calendar says for the next few days (today through
  // the day after tomorrow, the back-to-back-hard-days rule needs all three) rather
  // than defaulting to "riposo" for a day that actually has a workout scheduled.
  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWorkouts(today, shiftDateKey(today, 2), liveMode);
  const sessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);

  const fuelQuery = useFuelTargets(today, sessions, manualWeight?.weightKg);
  const narrativeQuery = useFuelNarrative(today, sessions, manualWeight?.weightKg, !!fuelQuery.data);
  const dayQuery = useFoodDay(today);
  const logPhoto = useLogPhoto();
  const deleteEntry = useDeleteEntry();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [correcting, setCorrecting] = useState<FoodEntry | null>(null);

  function openCamera() {
    fileInputRef.current?.click();
  }

  function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    cancelledRef.current = false;
    setFlow({ kind: "estimating", previewUrl });

    createThumbnail(file).then((thumbnail) => {
      logPhoto.mutate(
        { file, date: today, thumbnail },
        {
          onSuccess: (entry) => {
            if (cancelledRef.current) {
              // The user hit "Annulla" while the request was in flight -- the row is
              // already written server-side (nutrition.py writes it even on failure), so
              // it has to be cleaned up rather than left as a phantom empty entry.
              deleteEntry.mutate(entry.id);
              return;
            }
            setFlow(entry.confidence != null ? { kind: "review", entry, previewUrl } : { kind: "failed", entry, previewUrl });
          },
          onError: () => {
            if (!cancelledRef.current) setFlow({ kind: "idle" });
          },
        }
      );
    });
  }

  function closeFlow() {
    if (flow.kind !== "idle") URL.revokeObjectURL(flow.previewUrl);
    setFlow({ kind: "idle" });
  }

  function cancelEstimating() {
    cancelledRef.current = true;
    closeFlow();
  }

  function discardReview(entry: FoodEntry) {
    deleteEntry.mutate(entry.id);
    closeFlow();
  }

  function retakePhoto(entry: FoodEntry) {
    deleteEntry.mutate(entry.id);
    closeFlow();
    openCamera();
  }

  if (flow.kind === "estimating") {
    return <EstimatingScreen previewUrl={flow.previewUrl} onCancel={cancelEstimating} />;
  }
  if (flow.kind === "review") {
    return <ReviewScreen entry={flow.entry} previewUrl={flow.previewUrl} onDiscard={() => discardReview(flow.entry)} onSaved={closeFlow} />;
  }
  if (flow.kind === "failed") {
    return <FailedScreen onRetake={() => retakePhoto(flow.entry)} onSaved={closeFlow} entryId={flow.entry.id} />;
  }

  const fuel = fuelQuery.data;
  const day = dayQuery.data;
  const entries = day?.entries ?? [];
  const hasPlan = sessions.length > 0;

  return (
    <div style={{ padding: "22px 20px 130px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/body" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>
          carburante · {formatWeekday(today)} {new Date(`${today}T00:00:00`).getDate()}
        </span>
      </div>

      {fuelQuery.isLoading || !fuel ? (
        <p style={{ marginTop: 20 }}>Carico i dati…</p>
      ) : (
        <>
          <HeroTomorrow animate={animate} fuel={fuel} narrativeText={narrativeQuery.data?.text} />

          {fuel.weight_source === "reference" && (
            <SlideUp active={animate} delayMs={200} style={{ marginTop: 10 }}>
              <Link
                href="/settings/body"
                className="tap-target"
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: "16px 18px", textDecoration: "none", color: "inherit" }}
              >
                <span>
                  <span style={{ fontWeight: 700, fontSize: 15, display: "block" }}>Aggiungi il tuo peso</span>
                  <span style={{ fontSize: 12.5, color: "var(--inchiostro-50)" }}>dieci secondi, una volta sola</span>
                </span>
                <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--inchiostro)", color: "var(--crema)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  →
                </span>
              </Link>
            </SlideUp>
          )}

          <TodayBlock animate={animate} fuel={fuel} totals={day?.totals} hasPlan={hasPlan} />

          <MealList entries={entries} animate={animate} onSelect={setCorrecting} />

          {entries.length > 0 && (
            <SlideUp active={animate} delayMs={340} style={{ marginTop: 4 }}>
              <Link href="/body/fuel/history" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 4px", textDecoration: "none", color: "inherit" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Sette giorni</span>
                <span aria-hidden="true">→</span>
              </Link>
            </SlideUp>
          )}

          <CommentBlock animate={animate} text={narrativeQuery.data?.text ?? fuel.advice} />
        </>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={onFileSelected} style={{ display: "none" }} />

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "center", zIndex: 15, pointerEvents: "none" }}>
        <div style={{ width: "100%", maxWidth: "var(--frame-max-width)", padding: "0 20px 16px", pointerEvents: "auto" }}>
          <button
            type="button"
            onClick={openCamera}
            disabled={logPhoto.isPending}
            className="tap-target"
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, background: "var(--corallo)", color: "var(--corallo-testo)", border: "none", borderRadius: "var(--radius-pill)", padding: "17px 22px", fontSize: 16, fontWeight: 700, cursor: "pointer", boxShadow: "0 8px 20px rgba(28,26,22,.18)" }}
          >
            <span aria-hidden="true">📷</span> Fotografa il piatto
          </button>
          <p style={{ textAlign: "center", fontSize: 11, color: "var(--inchiostro-35)", fontWeight: 500, margin: "8px 0 0" }}>
            Orientamento sportivo generale, non un consiglio clinico.
          </p>
        </div>
      </div>

      {correcting && <FuelCorrectionSheet entry={correcting} onClose={() => setCorrecting(null)} />}
    </div>
  );
}

// ---- C1: hero "domani" -----------------------------------------------------------------

function HeroTomorrow({ animate, fuel, narrativeText }: { animate: boolean; fuel: FuelTargets; narrativeText?: string }) {
  const degraded = fuel.weight_source === "reference";
  const t = fuel.tomorrow;
  const title = t.session_title ? capitalize(t.session_title) : t.load === "riposo" ? "Domani riposo" : "Allenamento";

  return (
    <SlideUp
      active={animate}
      delayMs={100}
      style={{ background: degraded ? "var(--sabbia)" : "var(--inchiostro)", color: degraded ? "var(--inchiostro)" : "var(--crema)", borderRadius: "var(--radius-card-lg)", padding: 20, marginTop: 16 }}
    >
      <p style={{ fontSize: 12, opacity: 0.65, margin: "0 0 4px" }}>domani · {formatFullDate(t.date)}</p>
      <p style={{ font: "700 24px/1.1 var(--font-outfit)", margin: "0 0 14px" }}>{title}</p>

      {t.carb_g && (
        <p className="font-mono" style={{ fontSize: 40, fontWeight: 500, color: "var(--corallo)", margin: 0, lineHeight: 1 }}>
          {t.carb_g[0]}–{t.carb_g[1]} <span style={{ fontSize: 17, fontWeight: 400, color: degraded ? "var(--inchiostro-70)" : "var(--inchiostro-su-scuro)" }}>g</span>
        </p>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span style={{ fontSize: 13, opacity: 0.65 }}>
          {t.carb_g_per_kg[0]}–{t.carb_g_per_kg[1]} g per kg
        </span>
        {degraded && (
          <span style={{ background: "var(--giallo)", color: "var(--giallo-testo)", borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 11, fontWeight: 600 }}>
            su 70 kg di riferimento
          </span>
        )}
      </div>

      <p className="font-serif-italic" style={{ fontSize: 15, marginTop: 14, opacity: 0.95 }}>{narrativeText ?? fuel.advice}</p>
    </SlideUp>
  );
}

// ---- C2: "oggi" block, empty vs logged --------------------------------------------------

const RING_SIZE = 104;

function TodayBlock({ animate, fuel, totals, hasPlan }: { animate: boolean; fuel: FuelTargets; totals: DayTotals | undefined; hasPlan: boolean }) {
  const t: DayTarget = fuel.today;
  const hasEntries = !!totals && totals.entries > 0;
  const subtitle = !hasPlan ? "nessun piano importato" : t.session_title ? t.session_title.toLowerCase() : t.load === "riposo" ? "riposo" : t.load;

  return (
    <SlideUp active={animate} delayMs={240} style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", padding: 18, marginTop: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <p style={{ font: "700 17px/1 var(--font-outfit)", margin: 0 }}>Oggi</p>
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{subtitle}</span>
      </div>

      {!hasPlan && <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>Senza sapere cosa corri uso i valori di mantenimento.</p>}

      {hasEntries && totals ? (
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 14 }}>
          <ProgressRing key={Math.round(totals.carb_g)} value={t.carb_g ? totals.carb_g / t.carb_g[1] : 0} size={RING_SIZE} strokeWidth={11} trackColor="var(--sabbia-chip)">
            <div style={{ textAlign: "center" }}>
              <p className="font-mono" style={{ fontSize: 26, fontWeight: 500, margin: 0 }}>{Math.round(totals.carb_g)}</p>
              <p style={{ fontSize: 10, color: "var(--inchiostro-50)", margin: 0 }}>g carbo</p>
            </div>
          </ProgressRing>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{t.carb_g ? `su ${t.carb_g[0]}-${t.carb_g[1]} g` : ""}</span>
              <span style={{ background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "3px 10px", fontSize: 10, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase" }}>stima</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
              <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>proteine</span>
              <span className="font-mono" style={{ fontSize: 13 }}>{Math.round(totals.protein_g)} g</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <BarGrow value={t.protein_g ? totals.protein_g / t.protein_g[1] : 0} color="var(--azzurro-tratto)" trackColor="var(--sabbia-chip)" height={7} />
            </div>
            {t.protein_g && (
              <p style={{ fontSize: 11, color: "var(--inchiostro-35)", margin: "5px 0 0" }}>
                su {t.protein_g[0]}-{t.protein_g[1]} g
              </p>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
              <span style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>grassi</span>
              <span className="font-mono" style={{ fontSize: 13 }}>{Math.round(totals.fat_g)} g</span>
            </div>
            <div style={{ marginTop: 6 }}>
              <BarGrow value={t.fat_g ? totals.fat_g / t.fat_g[1] : 0} color="var(--lilla)" trackColor="var(--sabbia-chip)" height={7} />
            </div>
            {t.fat_g && (
              <p style={{ fontSize: 11, color: "var(--inchiostro-35)", margin: "5px 0 0" }}>
                su {t.fat_g[0]}-{t.fat_g[1]} g
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <TargetTile label="carboidrati" range={t.carb_g} />
            <TargetTile label="proteine" range={t.protein_g} />
            <TargetTile label="grassi" range={t.fat_g} />
          </div>
          <p style={{ fontSize: 12.5, color: "var(--inchiostro-50)", marginTop: 10 }}>
            {hasPlan && "Non hai ancora fotografato niente. "}Questi sono i target del giorno, non un debito.
          </p>
        </>
      )}
    </SlideUp>
  );
}

function TargetTile({ label, range }: { label: string; range: [number, number] | null }) {
  return (
    <div style={{ flex: 1, background: "var(--sabbia)", borderRadius: "var(--radius-chip)", padding: 14 }}>
      <p style={{ fontSize: 11, color: "var(--inchiostro-50)", margin: "0 0 6px" }}>{label}</p>
      {range && (
        <p className="font-mono" style={{ fontSize: 20, fontWeight: 500, margin: "0 0 8px" }}>
          {range[0]}-{range[1]} <span style={{ fontSize: 12, fontWeight: 400 }}>g</span>
        </p>
      )}
      <div style={{ height: 4, borderRadius: 100, background: "var(--neutro-barra)" }} />
    </div>
  );
}

// ---- C3: meal list -----------------------------------------------------------------------

function MealList({ entries, animate, onSelect }: { entries: FoodEntry[]; animate: boolean; onSelect: (e: FoodEntry) => void }) {
  if (entries.length === 0) return null;
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}>Pasti di oggi</span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-50)" }}>
          {entries.length} {entries.length === 1 ? "voce" : "voci"}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 10 }}>
        {entries.map((entry, i) => (
          <SlideUp key={entry.id} active={animate} delayMs={300 + i * 60} row>
            <MealRow entry={entry} onSelect={onSelect} />
          </SlideUp>
        ))}
      </div>
    </div>
  );
}

function MealRow({ entry, onSelect }: { entry: FoodEntry; onSelect: (e: FoodEntry) => void }) {
  const low = entry.confidence === "low";
  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      className="tap-target"
      style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, background: "var(--crema-card)", border: low ? "1.5px dashed var(--sabbia-bordo)" : "1.5px solid transparent", borderRadius: "var(--radius-row)", padding: 12, textAlign: "left", cursor: "pointer" }}
    >
      <FoodThumb entry={entry} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 600, fontSize: 14, margin: "0 0 3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: low ? "var(--inchiostro-70)" : "var(--inchiostro)" }}>
          {entry.description ?? "Pasto"}
        </p>
        <p className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)", margin: 0 }}>
          {low && "~"}
          {entry.carb_g != null ? Math.round(entry.carb_g) : "—"} g C · {low && "~"}
          {entry.protein_g != null ? Math.round(entry.protein_g) : "—"} g P
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flex: "none" }}>
        <span className="font-mono" style={{ fontSize: 12, color: "var(--inchiostro-50)" }}>{formatClockTime(entry.logged_at)}</span>
        <ConfidenceBadge entry={entry} />
      </div>
    </button>
  );
}

function ConfidenceBadge({ entry }: { entry: FoodEntry }) {
  if (entry.corrected) return <Chip background="var(--sabbia-chip)" color="var(--inchiostro-70)">corretto da te</Chip>;
  if (entry.confidence === "low") return <Chip background="var(--rosa-avviso)" color="var(--rosso-testo)">bassa</Chip>;
  if (entry.confidence === "medium") return <Chip background="var(--sabbia-chip)" color="var(--inchiostro-70)">media</Chip>;
  if (entry.confidence === "high") return <Chip background="var(--verde)" color="var(--verde-testo)">alta</Chip>;
  return null;
}

function Chip({ background, color, children }: { background: string; color: string; children: ReactNode }) {
  return <span style={{ background, color, borderRadius: "var(--radius-pill)", padding: "4px 10px", fontSize: 11, fontWeight: 700, flex: "none" }}>{children}</span>;
}

// ---- C5: comment block ---------------------------------------------------------------------

function CommentBlock({ animate, text }: { animate: boolean; text: string }) {
  return (
    <SlideUp active={animate} delayMs={380} style={{ background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: 16, marginTop: 14 }}>
      <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--inchiostro-70)", margin: 0 }}>{text}</p>
    </SlideUp>
  );
}

// ---- D2: "sto stimando" -------------------------------------------------------------------

function DarkSkeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number | string }) {
  return (
    <div style={{ width, height, borderRadius: 8, background: "rgba(246,238,218,.14)", position: "relative", overflow: "hidden" }}>
      <span aria-hidden="true" className="anim-sheen" style={{ position: "absolute", inset: 0, width: "50%", background: "linear-gradient(90deg, rgba(246,238,218,0), rgba(246,238,218,.28), rgba(246,238,218,0))" }} />
    </div>
  );
}

function EstimatingScreen({ previewUrl, onCancel }: { previewUrl: string; onCancel: () => void }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "22px 20px 28px", display: "flex", flexDirection: "column" }}>
      <div style={{ position: "relative", borderRadius: "var(--radius-card-lg)", overflow: "hidden", border: "2px dashed rgba(246,238,218,.35)", aspectRatio: "1 / 1" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset */}
        <img src={previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        <div style={{ position: "absolute", bottom: 16, left: 16 }}>
          <PulseRing size={14} />
        </div>
      </div>

      <p style={{ font: "700 26px/1.15 var(--font-outfit)", margin: "24px 0 0" }}>
        Sto guardando
        <br />
        il piatto
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

      <button type="button" onClick={onCancel} className="tap-target" style={{ marginTop: "auto", alignSelf: "center", background: "none", border: "none", color: "var(--inchiostro-su-scuro)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Annulla
      </button>
    </div>
  );
}

// ---- D3: estimate card ----------------------------------------------------------------------

function ReviewMacroField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
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

function confidenceLabel(confidence: FoodEntry["confidence"]): string {
  return confidence === "low" ? "bassa" : confidence === "medium" ? "media" : confidence === "high" ? "alta" : "";
}

function ReviewScreen({ entry, previewUrl, onDiscard, onSaved }: { entry: FoodEntry; previewUrl: string; onDiscard: () => void; onSaved: () => void }) {
  const updateEntry = useUpdateEntry();
  const [description, setDescription] = useState(entry.description ?? "");
  const [carb, setCarb] = useState(entry.carb_g != null ? String(Math.round(entry.carb_g)) : "");
  const [protein, setProtein] = useState(entry.protein_g != null ? String(Math.round(entry.protein_g)) : "");
  const [fat, setFat] = useState(entry.fat_g != null ? String(Math.round(entry.fat_g)) : "");
  const [kcal, setKcal] = useState(entry.kcal != null ? String(Math.round(entry.kcal)) : "");

  const dirty =
    description !== (entry.description ?? "") ||
    carb !== (entry.carb_g != null ? String(Math.round(entry.carb_g)) : "") ||
    protein !== (entry.protein_g != null ? String(Math.round(entry.protein_g)) : "") ||
    fat !== (entry.fat_g != null ? String(Math.round(entry.fat_g)) : "") ||
    kcal !== (entry.kcal != null ? String(Math.round(entry.kcal)) : "");

  function save() {
    // Confirming an unedited estimate is not a correction -- only an actual change
    // marks the entry `corrected` (see EDITABLE_FIELDS in db.py). Otherwise the row
    // stays exactly as the vision model wrote it, confidence chip and all.
    if (!dirty) {
      onSaved();
      return;
    }
    updateEntry.mutate(
      {
        id: entry.id,
        description: description || null,
        carb_g: carb === "" ? null : Number(carb),
        protein_g: protein === "" ? null : Number(protein),
        fat_g: fat === "" ? null : Number(fat),
        kcal: kcal === "" ? null : Number(kcal),
      },
      { onSuccess: onSaved }
    );
  }

  const low = entry.confidence === "low";

  return (
    <div style={{ minHeight: "100dvh", background: "var(--crema)", padding: "22px 20px 28px" }}>
      <div style={{ position: "relative", borderRadius: "var(--radius-card-lg)", overflow: "hidden", aspectRatio: "1 / 1" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset */}
        <img src={previewUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
        <button type="button" onClick={onDiscard} className="tap-target" style={{ background: "var(--sabbia)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Scarta
        </button>
        <button type="button" onClick={save} disabled={updateEntry.isPending} className="tap-target" style={{ flex: 1, background: "var(--inchiostro)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}>
          Salva
        </button>
      </div>
    </div>
  );
}

// ---- D4: failed estimate --------------------------------------------------------------------

/** Screen 27: deliberately zero motion (no SlideUp/WordIn anywhere here) -- SPEC.md's
 * "regola delle schermate ferme". */
function FailedScreen({ entryId, onRetake, onSaved }: { entryId: number; onRetake: () => void; onSaved: () => void }) {
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
      <p style={{ font: "700 30px/1.1 var(--font-outfit)", color: "var(--rosso-testo)", margin: "10px 0 0" }}>
        Da questa foto
        <br />
        non ci arrivo
      </p>
      <p className="font-serif-italic" style={{ fontSize: 15, color: "var(--rosa-testo-50)", margin: "14px 0 0" }}>
        Troppo poca luce, o il piatto è coperto. Non voglio inventarti dei numeri.
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

      <button
        type="button"
        onClick={save}
        disabled={updateEntry.isPending}
        className="tap-target"
        style={{ marginTop: "auto", background: "var(--rosso-forte)", color: "var(--crema)", border: "none", borderRadius: "var(--radius-pill)", padding: "16px 22px", fontSize: 15, fontWeight: 700, cursor: "pointer" }}
      >
        Salva quello che ho scritto
      </button>
      <button type="button" onClick={onRetake} className="tap-target" style={{ marginTop: 12, alignSelf: "center", background: "none", border: "none", color: "var(--rosso-testo)", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
        Rifai la foto
      </button>
    </div>
  );
}
