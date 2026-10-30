"use client";

import { dis } from "@/lib/disabled";
import { markFlowComplete, useFlowTracking } from "@/lib/useTracking";
import { useRef, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { safeReturnHref } from "@/lib/navigation";
import { PulseRing, Skeleton, SlideUp } from "@/components/motion/primitives";
import { ChevronRight, ArrowRight, PencilIcon, CameraIcon, UtensilsIcon } from "@/components/Icons";
import { FuelCorrectionSheet, PortionPicker, macroAtPortion } from "@/components/FuelCorrectionSheet";
import { DayEnergyCard } from "@/components/DayEnergyCard";
import { MealList } from "@/components/FuelBlocks";
import { FuelDayPlan } from "@/components/FuelDayPlan";
import { useTrainingSlot } from "@/lib/trainingHabits";
import { FuelReminderCard } from "@/components/FuelReminderCard";
import { useMountOnce } from "@/lib/motion";
import { formatFullDate } from "@/lib/format";
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
import { useScreenReady } from "@/lib/useScreenReady";

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
  const calendarToday = toDateKey(new Date());
  const params = useSearchParams();
  const router = useRouter();
  const requestedDate = params.get("date");
  const today = requestedDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedDate) && !Number.isNaN(new Date(`${requestedDate}T12:00:00`).getTime()) ? requestedDate : calendarToday;
  const view = params.get("view") === "diary" ? "diary" : "plan";
  const from = safeReturnHref(params.get("from"), "");
  const openRequested = params.get("log") === "1";
  const [logOpen, setLogOpen] = useState(openRequested);
  function setDay(date: string) { if (date) router.replace(`/nutrition?date=${date}&view=${view}`, { scroll: false }); }
  function setView(next: string) { router.replace(`/nutrition?date=${today}&view=${next}`, { scroll: false }); }
  function finishMeal() { markFlowComplete("meal"); closeFlow(); setLogOpen(false); if (from) router.push(from); else setView("diary"); }

  const liveMode = !access.plan && access.garminConnected;
  const workoutsQuery = useWorkouts(today, shiftDateKey(today, 2), liveMode);
  const sessions = access.plan ? access.plan.sessions : workoutsToSessions(workoutsQuery.data?.workouts ?? []);

  const sessionsReady = access.ready && (!liveMode || !workoutsQuery.isPending);
  // When today's session happens -- the user's habit for this weekday unless they said
  // otherwise for today. Targets wait for it, or they would be asked for twice.
  const training = useTrainingSlot(today, access.ready);
  const fuelQuery = useFuelTargets(today, sessions, manualWeight?.weightKg, sessionsReady && training.ready, training.slot);
  useScreenReady(sessionsReady && (fuelQuery.isError || !!fuelQuery.data), "/nutrition");
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

  const logDate = today;
  const mealError = logPhoto.error ?? describeMeal.error ?? addManualEntry.error ?? deleteEntry.error;

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
      { onSuccess: finishMeal }
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
    return <ReviewScreen entry={flow.entry} preview={flow.preview} onDiscard={() => discardReview(flow.entry)} onSaved={finishMeal} />;
  }
  if (flow.kind === "failed") {
    return (
      <FailedScreen
        preview={flow.preview}
        onRetake={() => retry(flow.entry, flow.preview)}
        onSaved={finishMeal}
        entryId={flow.entry.id}
      />
    );
  }

  const fuel = fuelQuery.data;
  const day = dayQuery.data;
  const entries = day?.entries ?? [];
  const narrative = narrativeQuery.data?.text;

  return (
    <PullToRefresh onRefresh={() => refreshMutation.mutateAsync()}>
      <div className="workspace-page">
        <header className="workspace-heading"><div><h1>Nutrizione</h1><p>Indicazioni e registrazioni della tua giornata.</p></div></header>
        <div className="nutrition-date"><button className="ux-button" aria-label="Giorno precedente" data-track="nutrition.previous-day" onClick={() => setDay(shiftDateKey(today, -1))}>‹</button><label className="ux-field">Giornata<input type="date" value={today} onChange={e => setDay(e.target.value)} data-track="nutrition.date" /></label><button className="ux-button" aria-label="Giorno successivo" data-track="nutrition.next-day" onClick={() => setDay(shiftDateKey(today, 1))}>›</button></div>
        <p className="ux-muted">{formatFullDate(today)}{today === calendarToday ? " · Oggi" : ""}</p>
        <nav className="section-nav" aria-label="Sezioni nutrizione"><a href={`/nutrition?date=${today}&view=plan`} aria-current={view === "plan" ? "page" : undefined} onClick={e => { e.preventDefault(); setView("plan"); }} data-track="nutrition.plan">Piano del giorno</a><a href={`/nutrition?date=${today}&view=diary`} aria-current={view === "diary" ? "page" : undefined} onClick={e => { e.preventDefault(); setView("diary"); }} data-track="nutrition.diary">Diario</a></nav>
        <button className="ux-button ux-button-primary" data-track="nutrition.register-meal" onClick={() => setLogOpen(true)}>Registra pasto</button>
        {mealError && <p className="ux-error" role="alert">{mealError.message || "La registrazione non è riuscita. I dati inseriti restano disponibili: riprova."}</p>}
        {logOpen && <section className="meal-entry-picker" aria-label="Registra pasto"><div className="program-topline"><h2 className="ux-section-title">Pasto del {formatFullDate(logDate)}</h2><button className="ux-button" data-track="nutrition.close-registration" onClick={() => { setLogOpen(false); if (from) router.push(from); }}>Annulla</button></div><p className="ux-muted">Scegli come inserirlo. Potrai verificare porzioni e valori prima di confermare.</p><div className="ux-actions"><button className="ux-button" data-track="nutrition.photo" {...dis(logPhoto.isPending, "in_caricamento")} onClick={openCamera}><CameraIcon size={18} />Foto</button><button className="ux-button" data-track="nutrition.text-manual" onClick={() => setFlow({ kind: "compose" })}><PencilIcon size={18} />Testo o valori manuali</button></div></section>}
        {view === "plan" ? fuelQuery.isError ? <div role="alert" className="ux-error"><p>Le indicazioni non sono disponibili. Puoi continuare a registrare i pasti nel Diario.</p><button className="ux-button" data-track="nutrition.retry-plan" {...dis(fuelQuery.isFetching, "in_caricamento")} onClick={() => fuelQuery.refetch()}>Riprova</button></div> : !fuel ? <Skeleton height={180} /> : <section className="nutrition-plan"><p className="ux-muted">Queste sono indicazioni per la giornata, non pasti già consumati. Gli orari degli allenamenti sono previsti.</p><FuelDayPlan fuel={fuel} status={statusQuery.data} narrative={narrative} training={training} animate={animate} /></section> : <section aria-label="Pasti registrati"><h2 className="ux-section-title">Pasti registrati</h2>{dayQuery.isPending ? <Skeleton height={100} /> : dayQuery.isError ? <div className="ux-error" role="alert"><p>Il diario non è disponibile.</p><button className="ux-button" data-track="nutrition.retry-diary" {...dis(dayQuery.isFetching, "in_caricamento")} onClick={() => dayQuery.refetch()}>Riprova</button></div> : entries.length ? <MealList entries={entries} animate={animate} onSelect={setCorrecting} /> : <div className="ux-empty"><h3>Nessun pasto registrato</h3><p>Questo diario mostra solo ciò che hai inserito. L’assenza di registrazioni non indica che tu non abbia mangiato.</p></div>}{showEnergy && dayEnergy.data && <DayEnergyCard energy={dayEnergy.data} numbers={true} animate={animate} delayMs={0} />}<div className="ux-actions"><Link className="ux-button" data-track="nutrition.diary-history" href={`/body/fuel/diario?from=${encodeURIComponent(`/nutrition?date=${today}&view=diary`)}`}>Storico delle registrazioni</Link></div></section>}
        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" onChange={onFileSelected} style={{ display: "none" }} />
        {correcting && <FuelCorrectionSheet entry={correcting} onClose={() => setCorrecting(null)} />}
      </div>
    </PullToRefresh>
  );
}
