"use client";

import { useState } from "react";
import { useAthleteIdentity } from "@/lib/identity";

function initials(name: string | undefined | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** The last-resort avatars, used when there is neither a photo nor a name to build
 * initials from -- a not-yet-connected first run. One is picked by hash below rather
 * than at random per render, so it stays the same face every time the app opens
 * instead of reshuffling under the user. */
const PLACEHOLDERS = [
  { emoji: "🏃", background: "var(--corallo-chiaro)", color: "var(--corallo-testo)" },
  { emoji: "🥾", background: "var(--verde)", color: "var(--verde-testo)" },
  { emoji: "⛰️", background: "var(--azzurro)", color: "var(--azzurro-testo)" },
  { emoji: "🌄", background: "var(--giallo)", color: "var(--giallo-testo)" },
  { emoji: "🧭", background: "var(--lilla)", color: "var(--lilla-testo)" },
];

function placeholderFor(seed: string) {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0;
  return PLACEHOLDERS[Math.abs(hash) % PLACEHOLDERS.length];
}

/** The account avatar, shown wherever the design puts one (screens 02, 08, 11, 15).
 *
 * Three tiers, in order: the connected account's photo, initials from its name, and a
 * placeholder face. The identity itself comes from Strava first and Garmin second (see
 * `useAthleteIdentity`); the locally typed name in Settings is only the last fallback
 * for the initials, since there is no real account behind it.
 *
 * A plain `<img>`, not `next/image`: the URL is an arbitrary Strava/Garmin CDN host
 * decided at runtime, which the optimizer would have to be configured for host by host,
 * and this is a 36px circle with nothing to optimize. A URL that fails to load (an
 * expired CDN link) falls through to the initials rather than showing a broken image.
 */
export function Avatar({ size = 36 }: { size?: number }) {
  const { name, imageUrl } = useAthleteIdentity();
  // The URL that failed, not a boolean: a later identity (a freshly connected account,
  // or Garmin's photo arriving after Strava's) must get its own chance to load.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const label = initials(name);
  const placeholder = label ? null : placeholderFor(name ?? "passo");

  const frame: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flex: "none",
  };

  if (imageUrl && imageUrl !== failedUrl) {
    return (
      <div aria-hidden="true" style={{ ...frame, background: "var(--sabbia-scura)" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- remote CDN host, see above */}
        <img
          src={imageUrl}
          alt=""
          width={size}
          height={size}
          onError={() => setFailedUrl(imageUrl)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      style={{
        ...frame,
        background: placeholder ? placeholder.background : "var(--sabbia-scura)",
        fontSize: Math.round(size * (placeholder ? 0.5 : 0.38)),
        fontWeight: 600,
        color: placeholder ? placeholder.color : "var(--inchiostro-70)",
        lineHeight: 1,
      }}
    >
      {placeholder ? placeholder.emoji : label}
    </div>
  );
}
