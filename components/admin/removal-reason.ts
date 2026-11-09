import { REMOVAL_REASON_MAX, REMOVAL_REASON_MIN } from "@/convex/lib/constants";

/** Client-side check of an admin removal reason, matching the server (trimmed, 3–200 characters). */
export function reasonError(reason: string): string | null {
  const length = [...reason.trim()].length;
  if (length < REMOVAL_REASON_MIN) return `Write at least ${REMOVAL_REASON_MIN} characters.`;
  if (length > REMOVAL_REASON_MAX) return `Keep it to ${REMOVAL_REASON_MAX} characters or fewer.`;
  return null;
}

/** Characters counted the way the limit is checked (trimmed, by code point). */
export function reasonLength(reason: string): number {
  return [...reason.trim()].length;
}
