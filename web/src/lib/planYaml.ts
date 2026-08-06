import { isRepeatBlock } from "./types";
import type { Step, TrainingSession } from "./types";

function y(value: string): string {
  // YAML double-quoted scalars follow JSON escaping rules, so this is a safe,
  // dependency-free way to emit any string value correctly.
  return JSON.stringify(value);
}

function formatPace(secondsPerKm: number): string {
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = secondsPerKm % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** One step as YAML list-item lines, at the given indent -- the same shape whether the
 * step sits at the top level or inside a `repeat:` block, only deeper. */
function stepLines(step: Step, indent: string): string[] {
  const lines = [
    `${indent}- type: ${step.type}`,
    `${indent}  duration_type: ${step.duration_type}`,
    `${indent}  duration_value: ${step.duration_value}`,
  ];
  if (step.target_pace) {
    const range = `${formatPace(step.target_pace.slower_sec_per_km)}-${formatPace(step.target_pace.faster_sec_per_km)}`;
    lines.push(`${indent}  target_pace: ${y(range)}`);
  }
  return lines;
}

/** Reflects the current in-browser plan (including edits from the body-conflict
 * screen) back into the file format described in the project README. */
export function serializePlanToYaml(sessions: TrainingSession[]): string {
  const lines: string[] = ["sessions:"];
  for (const session of sessions) {
    lines.push(`  - date: ${y(session.date)}`);
    lines.push(`    sport: ${session.sport}`);
    lines.push(`    title: ${y(session.title)}`);
    if (session.description) lines.push(`    description: ${y(session.description)}`);
    if (session.steps.length > 0) {
      lines.push("    steps:");
      for (const item of session.steps) {
        if (isRepeatBlock(item)) {
          lines.push(`      - repeat: ${item.reps}`);
          lines.push("        steps:");
          for (const step of item.steps) lines.push(...stepLines(step, "          "));
          continue;
        }
        lines.push(...stepLines(item, "      "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

export function downloadPlanYaml(sessions: TrainingSession[], filename = "piano.yaml") {
  const blob = new Blob([serializePlanToYaml(sessions)], { type: "text/yaml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
