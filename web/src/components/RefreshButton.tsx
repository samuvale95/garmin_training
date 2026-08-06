"use client";

import { useRefreshServerData } from "@/lib/queries";

/** "Ask Garmin and Strava again, now."
 *
 * Everything on these screens is cached -- in this client for minutes, and in the
 * backend's own TTL cache -- which is what makes moving between screens instant. That
 * trade needs an escape hatch: this clears both sides and refetches, while the data
 * currently on screen stays put until the new answer arrives.
 *
 * It lives in Impostazioni, spelled out in words: as a bare ↻ glyph in the header it
 * read as a mystery control, since a successful refresh usually redraws the very same
 * numbers and so looks like nothing happened.
 */
export function RefreshButton({ color = "var(--inchiostro)" }: { color?: string }) {
  const refresh = useRefreshServerData();

  return (
    <button
      type="button"
      onClick={() => refresh.mutate()}
      disabled={refresh.isPending}
      className="tap-target"
      style={{
        background: "none",
        border: "none",
        color,
        fontSize: 13,
        fontWeight: 600,
        padding: 0,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        cursor: refresh.isPending ? "default" : "pointer",
        opacity: refresh.isPending ? 0.5 : 1,
      }}
    >
      <span aria-hidden="true" className={refresh.isPending ? "anim-spin" : undefined} style={{ lineHeight: 1 }}>
        ↻
      </span>
      {refresh.isPending ? "Aggiorno…" : refresh.isSuccess ? "Dati aggiornati" : "Aggiorna i dati"}
    </button>
  );
}
