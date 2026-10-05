"use client";

import { WorkoutEditor } from "@/components/WorkoutEditor";
import { useScreenReady } from "@/lib/useScreenReady";

export default function NewSessionPage() {
  useScreenReady(true);
  return <WorkoutEditor mode="create" />;
}
