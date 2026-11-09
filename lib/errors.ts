import { ConvexError } from "convex/values";
import type { AppErrorData, ErrorCode } from "@/convex/lib/errors";

const GENERIC = "Something went wrong. Try again in a moment.";

function appData(e: unknown): AppErrorData | null {
  if (!(e instanceof ConvexError)) return null;
  const data: unknown = e.data;
  if (typeof data === "object" && data !== null && "code" in data && "message" in data) {
    return data as AppErrorData;
  }
  return null;
}

/**
 * The message to show a person for an error thrown by a Convex call.
 * Only `ConvexError` messages are written for users; anything else (network failures,
 * internal "Server Error"s) gets a generic line so internals never reach the UI.
 */
export function errorMessage(e: unknown): string {
  const data = appData(e);
  if (data) return data.message;
  if (e instanceof ConvexError && typeof e.data === "string") return e.data;
  return GENERIC;
}

/** The app error code (`CONFLICT`, `FORBIDDEN`, ...) of a Convex error, or null. */
export function errorCode(e: unknown): ErrorCode | null {
  return appData(e)?.code ?? null;
}
