/** Parse h:mm:ss or mm:ss without guessing the unit of a bare number. */
export function parseGoalTargetTime(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+:[0-5]\d(?::[0-5]\d)?$/.test(trimmed)) return null;
  const parts = trimmed.split(":");
  const values = parts.map(Number);
  if (values.slice(1).some(value => value > 59)) return null;
  const seconds = values.length === 2 ? values[0] * 60 + values[1] : values[0] * 3600 + values[1] * 60 + values[2];
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}
