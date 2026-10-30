"use client";

import { Suspense } from "react";
import { WorkoutEditor } from "@/components/WorkoutEditor";
import { useScreenReady } from "@/lib/useScreenReady";

export default function NewSessionPage() {
  useScreenReady(true);
  return <Suspense><WorkoutEditor mode="create" /></Suspense>;
}
