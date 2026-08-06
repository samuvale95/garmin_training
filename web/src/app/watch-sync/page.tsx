"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Illustration } from "@/components/Illustration";
import { PrimaryButton, SlideUp, WordIn } from "@/components/motion/primitives";
import { useMotionEnabled, useMountOnce } from "@/lib/motion";
import { useRefreshServerData } from "@/lib/queries";
import { lastSyncLabel, missingDataNote, useWatchSyncStatus } from "@/lib/watchSync";

/** Garmin Connect Mobile's URL scheme. The watch -> cloud sync is the Garmin app's job
 * and only its job: there is no API to trigger it from here, so the whole screen exists
 * to hand the user over to it (spec, "Comportamento"). */
const GARMIN_CONNECT_SCHEME = "gcm-ciq://";
const STORE_IOS = "https://apps.apple.com/app/garmin-connect/id583446403";
const STORE_ANDROID = "https://play.google.com/store/apps/details?id=com.garmin.android.apps.connectmobile";

/** Opens the app, or the store if it isn't installed.
 *
 * A custom scheme gives no "it failed" event, so the fallback is a timer that only gets
 * to run if the page was never backgrounded -- being backgrounded *is* the success
 * signal. The elapsed-time check covers the other direction: a throttled timer that
 * finally fires on the way back from Garmin Connect must not bounce the user to a store
 * page for an app they clearly have. */
function openGarminConnect(): void {
  const store = /iPad|iPhone|iPod/.test(navigator.userAgent) ? STORE_IOS : STORE_ANDROID;
  const startedAt = Date.now();
  let timer = 0;

  const stopFallback = () => {
    if (document.visibilityState !== "hidden") return;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", stopFallback);
  };

  timer = window.setTimeout(() => {
    document.removeEventListener("visibilitychange", stopFallback);
    if (document.visibilityState === "visible" && Date.now() - startedAt < 2000) {
      window.location.href = store;
    }
  }, 1200);

  document.addEventListener("visibilitychange", stopFallback);
  window.location.href = GARMIN_CONNECT_SCHEME;
}

/**
 * Screen 19 -- "L'orologio non ha ancora parlato".
 *
 * Stands in for Oggi and Come stai while the watch hasn't pushed to Garmin's cloud (see
 * useWatchSyncStatus). Deliberately cold -- azzurro + blu notte, no corallo anywhere --
 * so a glance tells it apart from the coral Home. It is seen often, and in the morning:
 * one title, one instruction, what's missing, and the way out.
 */
export default function WatchSyncPage() {
  const router = useRouter();
  const animate = useMountOnce("watch-sync");
  const { reduced } = useMotionEnabled();
  const watch = useWatchSyncStatus();
  const { mutate: recheck, isPending: rechecking } = useRefreshServerData();

  // The data arrived (here, or while the user was over in Garmin Connect): this screen
  // has nothing left to say, so it gets out of the way on its own.
  useEffect(() => {
    if (watch.ready && !watch.blocking) router.replace("/today");
  }, [watch.ready, watch.blocking, router]);

  // Coming back to the app is the whole point of the CTA, so re-ask on the way back
  // rather than making the user press "ricontrolla" for the thing they just did.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") recheck();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [recheck]);

  const note = missingDataNote(watch.missing);

  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--crema)", padding: "18px 20px 0" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden="true"
            className={reduced ? undefined : "anim-dot-pulse"}
            style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--azzurro-tratto)", flex: "none" }}
          />
          <span
            style={{ font: "500 11.5px var(--font-outfit)", letterSpacing: ".1em", textTransform: "uppercase", color: "var(--inchiostro-50)" }}
            aria-live="polite"
          >
            {rechecking ? "controllo in corso" : "in attesa dell'orologio"}
          </span>
        </div>

        {/* Two forced lines, not a wrapped paragraph: the break is part of the setting. */}
        <h1 style={{ margin: 0 }}>
          <WordIn active={animate} style={{ font: "600 32px/1.05 var(--font-outfit)", letterSpacing: "-.035em" }}>
            L&apos;orologio non
          </WordIn>
          <WordIn active={animate} delayMs={80} style={{ font: "600 32px/1.05 var(--font-outfit)", letterSpacing: "-.035em" }}>
            ha ancora parlato
          </WordIn>
        </h1>

        <SlideUp
          active={animate}
          delayMs={100}
          as="p"
          className="font-serif-italic"
          style={{ font: "italic 400 17.5px/1.4 var(--font-instrument-serif)", color: "var(--inchiostro-70)", maxWidth: 290, margin: 0 }}
        >
          Apri Garmin Connect con l&apos;orologio al polso: venti secondi e torno a dirti come stai.
        </SlideUp>

        <SlideUp
          active={animate}
          delayMs={180}
          style={{ position: "relative", height: 398, borderRadius: 28, background: "var(--azzurro)", color: "var(--azzurro-testo)", padding: 20, overflow: "hidden" }}
        >
          {/* Fixed 144: keeps the copy clear of the figure, which is anchored to the
              right edge and bleeds past it on wider screens rather than moving. */}
          <div style={{ position: "relative", zIndex: 1, width: 144 }}>
            <p style={{ font: "500 11px var(--font-outfit)", letterSpacing: ".1em", textTransform: "uppercase", opacity: 0.6, margin: 0 }}>
              ultimo sync
            </p>
            <p style={{ font: "600 22px/1.1 var(--font-outfit)", letterSpacing: "-.02em", margin: "4px 0 0" }}>
              {watch.ready ? lastSyncLabel(watch.lastSyncedAt) : "—"}
            </p>
            {note && (
              <p style={{ font: "500 12px/1.55 var(--font-outfit)", opacity: 0.8, margin: "10px 0 0" }}>{note}</p>
            )}
          </div>
          <Illustration name="sync" width={346} height={346} right={-44} bottom={-28} active={animate} delayMs={600} />
        </SlideUp>
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingBottom: 20 }}>
        <SlideUp active={animate} delayMs={400}>
          <PrimaryButton
            onClick={openGarminConnect}
            background="color-mix(in srgb, var(--azzurro-testo) 72%, var(--azzurro))"
            fillColor="var(--azzurro-testo)"
            textColor="var(--azzurro-su-scuro)"
          >
            Apri Garmin Connect
          </PrimaryButton>
        </SlideUp>
        {/* No toast when the answer is still "nothing": the screen simply stays, and the
            "ultimo sync" value updates only if it actually changed. */}
        <button
          type="button"
          onClick={() => recheck()}
          disabled={rechecking}
          className="tap-target"
          style={{
            background: "none",
            border: "none",
            width: "100%",
            font: "500 13px var(--font-outfit)",
            color: "var(--inchiostro-50)",
            cursor: rechecking ? "default" : "pointer",
            opacity: rechecking ? 0.5 : 1,
            padding: 0,
          }}
        >
          Ho già sincronizzato, ricontrolla
        </button>
      </div>
    </div>
  );
}
