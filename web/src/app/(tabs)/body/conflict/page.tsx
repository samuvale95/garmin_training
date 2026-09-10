"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Screen 13 ("Il corpo dice no") as it was: a full-screen takeover of Oggi, triggered
 * by a single low readiness score, and only ever about *tomorrow's* session.
 *
 * It has been replaced by "Stato del giorno" (`/body/stato`), which reads the same
 * snapshot plus sleep, resting heart rate, stress and training load, says what it read
 * and with which numbers, and is about the session actually in front of the user today.
 * The route stays so that a back-stack entry or a bookmark lands on the thing that
 * replaced it rather than on nothing.
 */
export default function BodyConflictPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/body/stato");
  }, [router]);
  return null;
}
