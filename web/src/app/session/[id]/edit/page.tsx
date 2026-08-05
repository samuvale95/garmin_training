"use client";

import { useParams } from "next/navigation";
import { WorkoutEditor } from "@/components/WorkoutEditor";

export default function EditSessionPage() {
  const params = useParams<{ id: string }>();
  return <WorkoutEditor mode="edit" sessionIndex={Number(params.id)} />;
}
