"use client";

import { useEffect } from "react";
import { apiPost } from "@/lib/apiClient";

// Asks the server to bring the stored history up to date, once per page load.
//
// Fire and forget: the server decides whether a sync is due (throttled, one at a time)
// and runs it in the background, so there is nothing to wait for and nothing to show.
// A failure here only means the history is as old as it was -- never worth an error.

let requested = false;

export function HistorySync() {
  useEffect(() => {
    if (requested) return;
    requested = true;
    apiPost("/history/sync").catch(() => {});
  }, []);
  return null;
}
