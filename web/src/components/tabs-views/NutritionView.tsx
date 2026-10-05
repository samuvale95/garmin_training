"use client";

import { dis } from "@/lib/disabled";
import { markFlowComplete, useFlowTracking } from "@/lib/useTracking";
import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { BrandMark } from "@/components/motion/BrandMark";
import { PulseRing, Skeleton, SlideUp } from "@/components/motion/primitives";
import { ChevronRight, ArrowRight, PencilIcon, CameraIcon, UtensilsIcon } from "@/components/Icons";
import { FuelCorrectionSheet, PortionPicker, macroAtPortion } from "@/components/FuelCorrectionSheet";
import { LogDayPicker, defaultLogDay, logDateKey, type LogDay } from "@/components/LogDayPicker";
import { useMounted } from "@/lib/hydration";
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
import { ComposeScreen, EstimatingScreen, ReviewScreen, FailedScreen } from "@/components/MealFlowScreens";
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
  useRefreshServerData,
  useUpdateEntry,
  useWorkouts,
} from "@/lib/queries";
import { usePassoStore } from "@/lib/store";
import { shiftDateKey, toDateKey, workoutsToSessions } from "@/lib/sessionVisuals";
import { PullToRefresh } from "@/components/PullToRefresh";
import type { FoodEntry } from "@/lib/types";
import { motion } from "framer-motion";

type Preview = { kind: "photo"; url: string } | { kind: "text"; text: string };

type Flow =
  | { kind: "idle" }
  | { kind: "compose" }
  | { kind: "estimating"; preview: Preview }
  | { kind: "review"; entry: FoodEntry; preview: Preview }
  | { kind: "failed"; entry: FoodEntry; preview: Preview };

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

export function NutritionView() {
  const animate = useMountOnce("nutrition-view");
  const access = useCalendarAccess();
  const refreshMutation = useRefreshServerData();
  const manualWeight = usePassoStore((s) => s.manualWeight);
  const today = toDateKey(new Date());

  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWorkouts(today, shiftDateKey(today, 2), liveMode);
  const sessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);

  const sessionsReady = access.ready && (!liveMode || !workoutsQuery.isPending);
  const fuelQuery = useFuelTargets(today, sessions, manualWeight?.weightKg, sessionsReady);
  const statusQuery = useFuelStatus(today, manualWeight?.weightKg, sessionsReady);
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
  useFlowTracking("meal", flow.kind);
  const [correcting, setCorrecting] = useState<FoodEntry | null>(null);
  const [runTimeSlot, setRunTimeSlot] = useState<RunTimeSlot>("pomeriggio");

  const mounted = useMounted();
  const [pickedLogDay, setPickedLogDay] = useState<LogDay | null>(null);
  const logDay: LogDay = pickedLogDay ?? (mounted ? defaultLogDay() : "oggi");
  const logDate = logDateKey(today, logDay);

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
      logPhoto.mutate({ file, date: logDate, thumbnail }, estimateHandlers(preview));
    });
  }

  function estimateHandlers(preview: Preview) {
    return {
      onSuccess: (entry: FoodEntry) => {
        if (cancelledRef.current) {
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

  function saveManualEntry(fields: { description: string; carb: string; protein: string; fat: string; kcal: string }) {
    const asNumber = (raw: string) => (raw === "" ? null : Number(raw));
    addManualEntry.mutate(
      {
        date: logDate,
        description: fields.description.trim() || null,
        carb_g: asNumber(fields.carb),
        protein_g: asNumber(fields.protein),
        fat_g: asNumber(fields.fat),
        kcal: asNumber(fields.kcal),
      },
      { onSuccess: () => { markFlowComplete("meal"); setFlow({ kind: "idle" }); } }
    );
  }

  function submitDescription(text: string) {
    const preview: Preview = { kind: "text", text };
    cancelledRef.current = false;
    setFlow({ kind: "estimating", preview });
    describeMeal.mutate({ text, date: logDate }, estimateHandlers(preview));
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
    return <ReviewScreen entry={flow.entry} preview={flow.preview} onDiscard={() => discardReview(flow.entry)} onSaved={() => { markFlowComplete("meal"); closeFlow(); }} />;
  }
  if (flow.kind === "failed") {
    return (
      <FailedScreen
        preview={flow.preview}
        onRetake={() => retry(flow.entry, flow.preview)}
        onSaved={() => { markFlowComplete("meal"); closeFlow(); }}
        entryId={flow.entry.id}
      />
    );
  }

  const fuel = fuelQuery.data;
  const day = dayQuery.data;
  const entries = day?.entries ?? [];
  const narrative = narrativeQuery.data?.text;
  const commentText = fuel && narrative && narrative !== fuel.advice ? fuel.advice : null;

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div style={{ padding: "22px 20px 24px" }}>
        {/* Header brand + settings */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <BrandMark height={22} />
          <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }} transition={{ type: "spring", stiffness: 450, damping: 22 }}>
            <Link data-track="nutrition.impostazioni" href="/settings" className="tap-target" aria-label="Impostazioni"><Avatar size={32} /></Link>
          </motion.div>
        </div>

        <header className="screen-intro" style={{ marginTop: 14 }}>
          <h1>Cosa mangiare oggi</h1>
          <p>Strategia nutrizionale intorno al tuo allenamento.</p>
        </header>

        {fuelQuery.isError ? (
          <div style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card)", padding: 20, marginTop: 18, border: "var(--border-airbnb)", textAlign: "center" }}>
            <p style={{ fontWeight: 700, fontSize: 16, margin: "0 0 6px" }}>Non riusciamo a caricare il carburante</p>
            <p className="font-serif-italic" style={{ fontSize: 13.5, color: "var(--inchiostro-70)", margin: "0 0 16px" }}>
              Si è verificato un problema di connessione con i dati di alimentazione.
            </p>
            <button data-track="nutrition.fuelquery-refetch"
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
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="anim-clay-shimmer" style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", height: 110, border: "var(--border-airbnb)" }} />
            <div className="anim-clay-shimmer" style={{ background: "var(--crema-card)", borderRadius: "var(--radius-card-lg)", height: 180, border: "var(--border-airbnb)" }} />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 16 }}>
            {/* 1. SCHEDA SEDUTA & SELETTORE ORARIO */}
            <SessionTimeSelectorCard
              animate={animate}
              fuel={fuel}
              timeSlot={runTimeSlot}
              onSelectTimeSlot={setRunTimeSlot}
            />

            {/* 2. PROMEMORIA PRE-CORSA */}
            <FuelReminderCard
              animate={animate}
              delayMs={120}
              todayTarget={fuel.today}
              timeSlot={runTimeSlot}
            />

            {/* 3. TIMELINE DELLA GIORNATA ALIMENTARE */}
            <DayFuelTimelineBlock
              animate={animate}
              fuel={fuel}
              timeSlot={runTimeSlot}
            />

            {/* 4. DOMANI IN ARRIVO */}
            <TomorrowFuelBanner
              animate={animate}
              fuel={fuel}
            />

            {/* 5. BILANCIO ENERGETICO */}
            {showEnergy && dayEnergy.data && (
              <DayEnergyCard
                energy={dayEnergy.data}
                numbers={true}
                animate={animate}
                delayMs={280}
              />
            )}

            {/* 6. DIARIO PASTI DEL GIORNO */}
            <div style={{ marginTop: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                <p className="font-mono" style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--inchiostro-50)", margin: 0 }}>
                  Pasti registrati oggi
                </p>
                <Link data-track="nutrition.body-fuel-diario" href="/body/fuel/diario" style={{ fontSize: 12, fontWeight: 600, color: "var(--rosso-avviso)", textDecoration: "none" }}>
                  Diario completo →
                </Link>
              </div>

              {/* Azioni rapide aggiunta pasto */}
              <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
                <button data-track="nutrition.opencamera"
                  type="button"
                  onClick={openCamera}
                  {...dis(logPhoto.isPending, "in_caricamento")}
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
                    padding: "11px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "var(--shadow-airbnb-subtle)",
                  }}
                >
                  <CameraIcon size={15} strokeWidth={2} />
                  <span>Fotografa</span>
                </button>
                <button data-track="nutrition.setflow"
                  type="button"
                  onClick={() => setFlow({ kind: "compose" })}
                  {...dis(describeMeal.isPending, "in_caricamento")}
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
                    padding: "11px 16px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    boxShadow: "var(--shadow-airbnb-subtle)",
                  }}
                >
                  <PencilIcon size={14} strokeWidth={2} />
                  <span>Scrivi</span>
                </button>
              </div>

              <MealList
                entries={entries}
                animate={animate}
                onSelect={(entry) => setCorrecting(entry)}
              />
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={onFileSelected}
              style={{ display: "none" }}
            />

            {correcting && (
              <FuelCorrectionSheet
                entry={correcting}
                onClose={() => setCorrecting(null)}
              />
            )}
          </div>
        )}
      </div>
    </PullToRefresh>
  );
}
