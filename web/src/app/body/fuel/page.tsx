"use client";

import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { PulseRing, Skeleton, SlideUp } from "@/components/motion/primitives";
import { ChevronLeft, ChevronRight, ArrowRight, PencilIcon, CameraIcon } from "@/components/Icons";
import { FuelCorrectionSheet, PortionPicker, macroAtPortion } from "@/components/FuelCorrectionSheet";
import { DayEnergyCard } from "@/components/DayEnergyCard";
import {
  SessionTimeSelectorCard,
  DayFuelTimelineBlock,
  TomorrowFuelBanner,
  MealList,
  type RunTimeSlot,
} from "@/components/FuelBlocks";
import { FuelReminderCard } from "@/components/FuelReminderCard";
import { useMountOnce } from "@/lib/motion";
import { formatWeekday } from "@/lib/format";
import { useCalendarAccess } from "@/lib/guards";
import {
  useAddManualEntry,
  useDeleteEntry,
  useDescribeMeal,
  useFoodDay,
  useAthleteLevel,
  useDayEnergy,
  useFuelNarrative,
  useFuelStatus,
  useFuelTargets,
  useLogPhoto,
  useUpdateEntry,
  useWorkouts,
} from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import type { FoodEntry } from "@/lib/types";

// ---- flow state: idle screen (C), or one of the photo-estimate states (D) ------------------

/** The two ways in are a photo and a sentence, and they converge immediately: from
 * "estimating" on, the only difference is whether there is an image to show. `preview`
 * carries that -- an object URL for a photo, the typed text for a description -- so
 * every state below is written once instead of twice. */
type Preview = { kind: "photo"; url: string } | { kind: "text"; text: string };

type Flow =
  | { kind: "idle" }
  | { kind: "compose" }
  | { kind: "estimating"; preview: Preview }
  | { kind: "review"; entry: FoodEntry; preview: Preview }
  | { kind: "failed"; entry: FoodEntry; preview: Preview };

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

  // Nothing is asked until the plan (or, in live mode, Garmin's calendar) is actually
  // here: a request sent on the first render carries an empty session list, and the
  // answer it buys -- a rest day's targets, a sentence about a day off -- is thrown
  // away the moment the real plan lands under a different cache key. It also doubled
  // the model calls this screen pays for.
  const sessionsReady = access.ready && (!liveMode || !workoutsQuery.isPending);
  const fuelQuery = useFuelTargets(today, sessions, manualWeight?.weightKg, sessionsReady);
  const statusQuery = useFuelStatus(today, manualWeight?.weightKg, sessionsReady);
  // Level 1 builds the habit: no calorie figures while it does.
  const level = useAthleteLevel();
  const showEnergy = (level.data?.level ?? 2) > 1;
  const dayEnergy = useDayEnergy(today, access.ready);
  const narrativeQuery = useFuelNarrative(today, sessions, manualWeight?.weightKg, sessionsReady && !!fuelQuery.data);
  const dayQuery = useFoodDay(today);
  const logPhoto = useLogPhoto();
  const describeMeal = useDescribeMeal();
  const addManualEntry = useAddManualEntry();
  const deleteEntry = useDeleteEntry();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);
  const [flow, setFlow] = useState<Flow>({ kind: "idle" });
  const [correcting, setCorrecting] = useState<FoodEntry | null>(null);
  const [runTimeSlot, setRunTimeSlot] = useState<RunTimeSlot>("pomeriggio");

  function openCamera() {
    fileInputRef.current?.click();
  }

  function onFileSelected(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const preview: Preview = { kind: "photo", url: URL.createObjectURL(file) };
    cancelledRef.current = false;
    setFlow({ kind: "estimating", preview });

    createThumbnail(file).then((thumbnail) => {
      logPhoto.mutate({ file, date: today, thumbnail }, estimateHandlers(preview));
    });
  }

  /** Both estimate calls land the same way: a row exists server-side either way, and
   * `confidence == null` is what tells "the model couldn't read it" apart from a
   * request that failed. */
  function estimateHandlers(preview: Preview) {
    return {
      onSuccess: (entry: FoodEntry) => {
        if (cancelledRef.current) {
          // The user hit "Annulla" while the request was in flight -- the row is
          // already written server-side (nutrition.py writes it even on failure), so
          // it has to be cleaned up rather than left as a phantom empty entry.
          deleteEntry.mutate(entry.id);
          return;
        }
        setFlow(entry.confidence != null ? { kind: "review", entry, preview } : { kind: "failed", entry, preview });
      },
      onError: () => {
        if (!cancelledRef.current) setFlow({ kind: "idle" });
      },
    };
  }

  /** No model, no review: these numbers came from the user, so they are stored exactly
   * as typed (the backend marks the row `corrected` for the same reason). */
  function saveManualEntry(fields: { description: string; carb: string; protein: string; fat: string; kcal: string }) {
    const asNumber = (raw: string) => (raw === "" ? null : Number(raw));
    addManualEntry.mutate(
      {
        date: today,
        description: fields.description.trim() || null,
        carb_g: asNumber(fields.carb),
        protein_g: asNumber(fields.protein),
        fat_g: asNumber(fields.fat),
        kcal: asNumber(fields.kcal),
      },
      { onSuccess: () => setFlow({ kind: "idle" }) }
    );
  }

  function submitDescription(text: string) {
    const preview: Preview = { kind: "text", text };
    cancelledRef.current = false;
    setFlow({ kind: "estimating", preview });
    describeMeal.mutate({ text, date: today }, estimateHandlers(preview));
  }

  function closeFlow() {
    if (flow.kind !== "idle" && flow.kind !== "compose" && flow.preview.kind === "photo") {
      URL.revokeObjectURL(flow.preview.url);
    }
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

  /** "Rifai la foto" / "Riscrivi": the failed row is dropped and the same way in
   * reopens, so a second attempt never leaves an empty entry behind. */
  function retry(entry: FoodEntry, preview: Preview) {
    deleteEntry.mutate(entry.id);
    closeFlow();
    if (preview.kind === "photo") openCamera();
    else setFlow({ kind: "compose" });
  }

  if (flow.kind === "compose") {
    return (
      <ComposeScreen
        onCancel={() => setFlow({ kind: "idle" })}
        onSubmit={submitDescription}
        onSaveManual={saveManualEntry}
        saving={addManualEntry.isPending}
      />
    );
  }
  if (flow.kind === "estimating") {
    return <EstimatingScreen preview={flow.preview} onCancel={cancelEstimating} />;
  }
  if (flow.kind === "review") {
    return <ReviewScreen entry={flow.entry} preview={flow.preview} onDiscard={() => discardReview(flow.entry)} onSaved={closeFlow} />;
  }
  if (flow.kind === "failed") {
    return (
      <FailedScreen
        preview={flow.preview}
        onRetake={() => retry(flow.entry, flow.preview)}
        onSaved={closeFlow}
        entryId={flow.entry.id}
      />
    );
  }

  const fuel = fuelQuery.data;
  const day = dayQuery.data;
  const entries = day?.entries ?? [];
  const hasPlan = sessions.length > 0;
  const narrative = narrativeQuery.data?.text;
  // The hero already prints one of these two sentences; the comment block only earns
  // its place when it has something else to say (the model's narrative shown above,
  // the deterministic advice below). Identical text stacked twice was the screen's
  // most visible flaw.
  const commentText = fuel && narrative && narrative !== fuel.advice ? fuel.advice : null;

  return (
    <div style={{ padding: "22px 20px 148px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <PageHeader backHref="/body" />
        <span style={{ fontSize: 13, color: "var(--inchiostro-50)" }}>corpo</span>
        <span className="font-mono" style={{ fontSize: 11, color: "var(--inchiostro-70)", background: "var(--sabbia-chip)", borderRadius: "var(--radius-pill)", padding: "5px 12px", marginLeft: "auto" }}>
          Oggi · {formatWeekday(today)} {new Date(`${today}T00:00:00`).getDate()}
        </span>
      </div>

      <div style={{ marginTop: 14 }}>
        <h1 style={{ font: "600 28px/1.1 var(--font-sans)", letterSpacing: "-.03em", margin: 0 }}>
          Cosa mangiare oggi
        </h1>
        <p className="font-serif-italic" style={{ fontSize: 15.5, color: "var(--inchiostro-70)", margin: "4px 0 0", lineHeight: 1.35 }}>
          La tua giornata a tavola intorno all&apos;allenamento.
        </p>
      </div>

      {fuelQuery.isError ? (
        <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 20, marginTop: 18, border: "var(--border-airbnb)", textAlign: "center" }}>
          <p style={{ fontWeight: 700, fontSize: 16, margin: "0 0 6px" }}>Non riusciamo a caricare il carburante</p>
          <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "0 0 16px" }}>
            Si è verificato un problema di connessione con i dati di alimentazione.
          </p>
          <button
            type="button"
            onClick={() => fuelQuery.refetch()}
            className="tap-target"
            style={{
              background: "var(--inchiostro)",
              color: "var(--crema)",
              border: "none",
              borderRadius: "var(--radius-pill)",
              padding: "10px 20px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Riprova
          </button>
        </div>
      ) : fuelQuery.isLoading || !fuel ? (
        <FuelSkeleton />
      ) : (
        <>
          {/* 1. SCHEDA SEDUTA & SELETTORE ORARIO (Chiara, amichevole, discreta) */}
          <SessionTimeSelectorCard
            animate={animate}
            fuel={fuel}
            timeSlot={runTimeSlot}
            onSelectTimeSlot={setRunTimeSlot}
          />

          {/* 1.5 PROMEMORIA MERENDA & IDRATAZIONE PRE-CORSA */}
          <FuelReminderCard
            animate={animate}
            delayMs={120}
            todayTarget={fuel.today}
            timeSlot={runTimeSlot}
          />

          {/* 2. TIMELINE DELLA GIORNATA ALIMENTARE (IL PROTAGONISTA) */}
          <DayFuelTimelineBlock
            animate={animate}
            fuel={fuel}
            timeSlot={runTimeSlot}
          />

          {/* 3. DOMANI IN ARRIVO */}
          <TomorrowFuelBanner animate={animate} fuel={fuel} />

          {/* 4. TODAY'S LOGGED MEALS (se presenti) */}
          <MealList entries={entries} animate={animate} onSelect={setCorrecting} />

          {/* 5. ENERGY BALANCE (se abilitato dai livelli atleta) */}
          {dayEnergy.data && <DayEnergyCard energy={dayEnergy.data} numbers={showEnergy} animate={animate} delayMs={280} />}

          {/* 6. NAVIGATION: Diary & 7-Day History */}
          <SlideUp active={animate} delayMs={340} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
            <Link
              href="/body/fuel/diario"
              className="press-soft"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: "13px 15px", textDecoration: "none", color: "inherit" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>Diario pasti</span>
              <ChevronRight size={15} style={{ color: "var(--inchiostro-50)" }} />
            </Link>
            <Link
              href="/body/fuel/history"
              className="press-soft"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, background: "var(--sabbia)", borderRadius: "var(--radius-card)", padding: "13px 15px", textDecoration: "none", color: "inherit" }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>Storico 7 giorni</span>
              <ChevronRight size={15} style={{ color: "var(--inchiostro-50)" }} />
            </Link>
          </SlideUp>
        </>
      )}

      <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={onFileSelected} style={{ display: "none" }} />

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, display: "flex", justifyContent: "center", zIndex: 15, pointerEvents: "none" }}>
        <div
          style={{
            width: "100%",
            maxWidth: "var(--frame-max-width)",
            padding: "24px 20px 14px",
            pointerEvents: "auto",
            background: "linear-gradient(to top, var(--crema) 75%, rgba(255,255,255,0))",
          }}
        >
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={openCamera}
              disabled={logPhoto.isPending}
              className="tap-target press-soft"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "var(--sabbia-chip)",
                color: "var(--inchiostro)",
                border: "var(--border-airbnb)",
                borderRadius: "var(--radius-pill)",
                padding: "12px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "var(--shadow-airbnb-subtle)",
              }}
            >
              <CameraIcon size={15} strokeWidth={2} />
              <span>Fotografa pasto</span>
            </button>
            <button
              type="button"
              onClick={() => setFlow({ kind: "compose" })}
              disabled={describeMeal.isPending}
              className="tap-target press-soft"
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
                background: "var(--sabbia-chip)",
                color: "var(--inchiostro)",
                border: "var(--border-airbnb)",
                borderRadius: "var(--radius-pill)",
                padding: "12px 16px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                boxShadow: "var(--shadow-airbnb-subtle)",
              }}
            >
              <PencilIcon size={13} style={{ display: "inline-block", verticalAlign: "middle" }} /> Scrivi pasto
            </button>
          </div>
          <p style={{ textAlign: "center", fontSize: 11, color: "var(--inchiostro-50)", margin: "8px 0 0" }}>
            Orientamento per l&apos;allenamento. Non è una dieta prescrittiva.
          </p>
        </div>
      </div>

      {correcting && <FuelCorrectionSheet entry={correcting} onClose={() => setCorrecting(null)} />}
    </div>
  );
}

/** MOTION.md §7.1: shape-matching rectangles, never a spinner and never a bare "Carico
 * i dati…" line where a card is about to appear. */
function FuelSkeleton() {
  return (
    <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <Skeleton height={232} radius={27} />
      <Skeleton height={196} radius={27} />
    </div>
  );
}


// ---- D1b: "scrivi cosa hai mangiato" ---------------------------------------------------------

/** The typed way in. The same weight as the camera, not a fallback behind it: most
 * meals are easier to say than to photograph ("80 g di pasta al pomodoro e due uova"),
 * and a stated quantity is a better estimate than any photo of the same plate. */
type ComposeMode = "stima" | "manuale";

function ModeTab({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="press-soft"
      style={{
        flex: 1,
        background: active ? "var(--crema-card)" : "none",
        color: active ? "var(--inchiostro)" : "var(--inchiostro-50)",
        border: "none",
        borderRadius: "var(--radius-pill)",
        padding: "10px 14px",
        fontSize: 13.5,
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

/** The typed way in, in its two forms.
 *
 * "Stima": a sentence the model turns into macros. "Manuale": the numbers stated
 * outright, no model involved, saved as they are typed -- for the meal whose label you
 * are holding, or the one you have logged fifty times. That second form existed in the
 * API and in `useAddManualEntry` from the start but had no screen anywhere: the only
 * way to reach a numeric field was to have an estimate *fail* first, which is not a
 * feature, it is a dead end you had to be unlucky to find.
 */
function ComposeScreen({
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
        <button
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

      <button
        type="button"
        onClick={submit}
        disabled={!ready || saving}
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

// ---- D2: "sto stimando" -------------------------------------------------------------------

function DarkSkeleton({ width = "100%", height = 14 }: { width?: number | string; height?: number | string }) {
  return (
    <div style={{ width, height, borderRadius: 8, background: "rgba(246,238,218,.14)", position: "relative", overflow: "hidden" }}>
      <span aria-hidden="true" className="anim-sheen" style={{ position: "absolute", inset: 0, width: "50%", background: "linear-gradient(90deg, rgba(246,238,218,0), rgba(246,238,218,.28), rgba(246,238,218,0))" }} />
    </div>
  );
}

function EstimatingScreen({ preview, onCancel }: { preview: Preview; onCancel: () => void }) {
  return (
    <div style={{ minHeight: "100dvh", background: "var(--inchiostro)", color: "var(--crema)", padding: "22px 20px 28px", display: "flex", flexDirection: "column" }}>
      {preview.kind === "photo" ? (
        <div style={{ position: "relative", borderRadius: "var(--radius-card-lg)", overflow: "hidden", border: "2px dashed rgba(246,238,218,.35)", aspectRatio: "1 / 1" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset */}
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

function ReviewScreen({ entry, preview, onDiscard, onSaved }: { entry: FoodEntry; preview: Preview; onDiscard: () => void; onSaved: () => void }) {
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
    // Confirming an unedited estimate is not a correction -- only an actual change
    // marks the entry `corrected` (see EDITABLE_FIELDS in db.py). Otherwise the row
    // stays exactly as the vision model wrote it, confidence chip and all. A portion
    // on its own is sent alone: the server rescales the estimate and it stays one.
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
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimizable asset
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
function FailedScreen({ entryId, preview, onRetake, onSaved }: { entryId: number; preview: Preview; onRetake: () => void; onSaved: () => void }) {
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
        {preview.kind === "photo" ? "Rifai la foto" : "Riscrivilo"}
      </button>
    </div>
  );
}
