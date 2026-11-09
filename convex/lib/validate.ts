import { fail } from "./errors";

/** Trims `value` and enforces a length range counted in characters (not UTF-16 units). */
export function cleanText(value: string, field: string, min: number, max: number): string {
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length < min || length > max) fail("INVALID", `${field} must be ${min}–${max} characters`);
  return trimmed;
}
