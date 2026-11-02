export function selectRaceGoal<T extends { id: string; type: string }>(goals: T[] | undefined, goalId: string): T | undefined {
  return goals?.find(goal => goal.id === goalId && goal.type === "race");
}

export function raceAssessment(evidence: unknown, metric: "race_prediction" | "race_plan_fit"): Record<string, unknown> | null {
  if (!Array.isArray(evidence)) return null;
  const item = evidence.find(value => value && typeof value === "object" && value.metric === metric);
  return item?.assessment && typeof item.assessment === "object" ? item.assessment as Record<string, unknown> : null;
}
