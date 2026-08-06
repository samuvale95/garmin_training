"use client";

import { useParams } from "next/navigation";
import { WorkoutEditor } from "@/components/WorkoutEditor";
import { SkeletonEditorForm } from "@/components/skeletons";
import { usePlanQuery } from "@/lib/queries";

export default function EditSessionPage() {
  const params = useParams<{ id: string }>();
  const { isHydrated } = usePlanQuery();

  // The editor seeds its whole form -- day, title, steps -- from the plan at mount and
  // never re-reads it, so it must not be mounted before the plan has been restored from
  // localStorage (a tick after load, see `usePlanQuery`). Opening this URL directly used
  // to build the form out of the plan-shaped nothing that exists in that first tick and
  // then keep it: today's date, no title, no steps -- and saving wrote *that* to Garmin
  // as a new workout. Same rule the Garmin-side twin of this route already follows.
  if (!isHydrated) return <SkeletonEditorForm />;
  return <WorkoutEditor mode="edit" sessionIndex={Number(params.id)} />;
}
