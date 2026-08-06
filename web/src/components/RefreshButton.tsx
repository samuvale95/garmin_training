"use client";

import { useRefreshServerData } from "@/lib/queries";

/** "Ask Garmin and Strava again, now."
 *
 * Everything on these screens is cached -- in this client for minutes, and in the
 * backend's own TTL cache -- which is what makes moving between screens instant. That
 * trade needs an escape hatch: this clears both sides and refetches, while the data
 * currently on screen stays put until the new answer arrives.
 */
export function RefreshButton({ color = "var(--inchiostro)" }: { color?: string }) {
  const refresh = useRefreshServerData();

  return (
    <button
      type="button"
      onClick={() => refresh.mutate()}
      disabled={refresh.isPending}
      className="tap-target"
      aria-label="Aggiorna i dati"
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: "var(--sabbia-chip)",
        color,
        border: "none",
        fontSize: 14,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: refresh.isPending ? "default" : "pointer",
        flex: "none",
        opacity: refresh.isPending ? 0.5 : 1,
      }}
    >
      <span aria-hidden="true" className={refresh.isPending ? "anim-spin" : undefined} style={{ lineHeight: 1 }}>
        ↻
      </span>
    </button>
  );
}
