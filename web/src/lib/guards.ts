"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePassoStore, type PlanState } from "./store";

/** Screens that need an imported plan redirect to /import when there isn't one --
 * matching the "no plan imported -> screen 03 is the home" empty state. */
export function useRequirePlan(): PlanState | null {
  const router = useRouter();
  const plan = usePassoStore((s) => s.plan);

  useEffect(() => {
    if (!plan) router.replace("/import");
  }, [plan, router]);

  return plan;
}
