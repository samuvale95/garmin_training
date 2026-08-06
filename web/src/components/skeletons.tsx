"use client";

import { Skeleton } from "@/components/motion/primitives";

/** Placeholders for the shapes each screen is about to fill.
 *
 * The rule they exist to enforce: a screen never renders nothing. Pages used to
 * `return null` until their data arrived, which on a slow Garmin call meant seconds of
 * an empty (and, on the detail screens, near-black) viewport -- read as "the app is
 * broken", not "the app is loading". These keep the layout on screen instead, so the
 * real content replaces a shape rather than appearing out of a void.
 *
 * Two palettes, because the app has two: the cream screens use `Skeleton`'s own sand
 * tone, while the detail screens sit on `--inchiostro` and need a light-on-dark wash.
 */

const DARK_FILL = "rgba(246,238,218,.09)";

export function SkeletonBlock({
  width = "100%",
  height = 16,
  radius = 8,
  dark = false,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  dark?: boolean;
}) {
  if (!dark) return <Skeleton width={width} height={height} radius={radius} />;
  return <div aria-hidden="true" style={{ width, height, borderRadius: radius, background: DARK_FILL }} />;
}

/** A day row on Settimana: the same 7 cards, still empty. */
export function SkeletonDayCards({ count = 7 }: { count?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ display: "flex", gap: 10 }}>
          <div style={{ width: 30, paddingTop: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <SkeletonBlock width={18} height={9} radius={4} />
            <SkeletonBlock width={14} height={11} radius={4} />
          </div>
          <div style={{ flex: 1 }}>
            <SkeletonBlock height={78} radius={18} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Oggi's hero card + the three metric tiles under it. */
export function SkeletonTodayHero() {
  return (
    <div aria-hidden="true">
      <SkeletonBlock height={210} radius={26} />
      <div style={{ display: "flex", gap: 9, marginTop: 16 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ flex: 1 }}>
            <SkeletonBlock height={104} radius={18} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The detail screens' body: distance ring, title, and a few step rows. */
export function SkeletonDetailBody() {
  return (
    <div
      aria-hidden="true"
      style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "center", marginTop: 8 }}
    >
      <div
        style={{
          width: 180,
          height: 180,
          borderRadius: "50%",
          border: `12px solid ${DARK_FILL}`,
          boxSizing: "border-box",
        }}
      />
      <div style={{ marginTop: 20, width: "70%" }}>
        <SkeletonBlock height={26} radius={8} dark />
      </div>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, marginTop: 24 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} height={62} radius={16} dark />
        ))}
      </div>
    </div>
  );
}

/** The workout form, while the workout it will be filled with is still being read
 * (`workout/[id]/edit`): the header row, the sport chips, the title card and a few step
 * rows, on the editor's own cream background. */
export function SkeletonEditorForm() {
  return (
    <div aria-hidden="true" style={{ minHeight: "100dvh", background: "var(--crema)", padding: "22px 20px 40px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SkeletonBlock width={22} height={22} radius={6} />
        <SkeletonBlock width={90} height={13} radius={6} />
        <SkeletonBlock width={22} height={22} radius={6} />
      </div>
      <div style={{ marginTop: 18 }}>
        <SkeletonBlock width="65%" height={32} radius={8} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        {[64, 52, 60, 62].map((width, i) => (
          <SkeletonBlock key={i} width={width} height={34} radius={999} />
        ))}
      </div>
      <div style={{ marginTop: 18 }}>
        <SkeletonBlock height={82} radius={18} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 26 }}>
        {[0, 1, 2].map((i) => (
          <SkeletonBlock key={i} height={58} radius={14} />
        ))}
      </div>
    </div>
  );
}

/** The planned-vs-done panel on the `/strava` screens. */
export function SkeletonStravaPanel() {
  return (
    <div aria-hidden="true">
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <div style={{ flex: 1 }}>
          <SkeletonBlock height={96} radius={18} dark />
        </div>
        <div style={{ flex: 1 }}>
          <SkeletonBlock height={96} radius={18} dark />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ marginTop: 10 }}>
          <SkeletonBlock height={62} radius={16} dark />
        </div>
      ))}
    </div>
  );
}
