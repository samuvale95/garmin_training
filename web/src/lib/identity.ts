"use client";

import { useGarminProfile, useGarminStatus, useStravaAthlete, useStravaStatus } from "./queries";
import { usePassoStore } from "./store";

export type IdentitySource = "strava" | "garmin" | "local" | "none";

export interface AthleteIdentity {
  name: string | null;
  imageUrl: string | null;
  /** Where `name` came from -- what the profile card labels ("da Strava"). */
  source: IdentitySource;
}

function clean(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Who the app should show as "you": Strava first, Garmin second, the locally typed
 * name last.
 *
 * Strava wins because it's the account the user actually curates a photo and a real
 * name on -- Garmin Connect profiles are frequently left as a bare display name with no
 * picture at all. Name and photo are resolved *independently* for that same reason: a
 * Strava account with a name but no photo should still borrow Garmin's, rather than
 * throwing away the only picture available.
 *
 * Both queries are gated on their connection status, so a disconnected account is never
 * asked for (it would only 401), and neither one blocks the avatar from rendering --
 * every consumer degrades on its own (see Avatar.tsx).
 */
export function useAthleteIdentity(): AthleteIdentity {
  const { data: stravaStatus } = useStravaStatus();
  const { data: garminStatus } = useGarminStatus();
  const { data: strava } = useStravaAthlete(stravaStatus?.connected ?? false);
  const { data: garmin } = useGarminProfile(garminStatus?.connected ?? false);
  const localName = usePassoStore((s) => s.profile.name);

  const stravaName = clean(strava?.name);
  const garminName = clean(garmin?.name);
  const name = stravaName ?? garminName ?? clean(localName);
  const source: IdentitySource = stravaName
    ? "strava"
    : garminName
      ? "garmin"
      : name
        ? "local"
        : "none";

  return {
    name,
    imageUrl: clean(strava?.image_url) ?? clean(garmin?.image_url),
    source,
  };
}
