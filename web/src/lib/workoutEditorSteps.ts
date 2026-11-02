import type { SessionStep, Step } from "@/lib/types";

type EditableStep = Step & { _id: string };
type EditableBlock = { _id: string; reps: number; steps: EditableStep[] };

/** Remove editor-only identities while retaining all imported step and block fields. */
export function stripEditableSteps(steps: (EditableStep | EditableBlock)[]): SessionStep[] {
  const strip = (step: EditableStep): Step => {
    const { _id, ...plain } = step;
    void _id;
    return plain;
  };
  return steps.flatMap((item): SessionStep[] => {
    if (!("reps" in item)) return [strip(item)];
    if (!item.steps.length) return [];
    if (item.reps < 2) return item.steps.map(strip);
    const { _id, ...block } = item;
    void _id;
    return [{ ...block, steps: item.steps.map(strip) }];
  });
}

/** Blank pairs clear a target; populated pairs must be positive and ordered. */
export function parseTargetRange(low: string, high: string): { low: number; high: number } | null | undefined {
  if (!low.trim() && !high.trim()) return null;
  if (!low.trim() || !high.trim()) return undefined;
  const a = Number(low), b = Number(high);
  return Number.isFinite(a) && Number.isFinite(b) && a > 0 && a < b ? { low: a, high: b } : undefined;
}

export function validPoolLength(value: string): boolean {
  if (!value.trim()) return true;
  const n = Number(value);
  return Number.isFinite(n) && n >= 10 && n <= 100;
}
