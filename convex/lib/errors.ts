import { ConvexError } from "convex/values";

export type ErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID" | "CONFLICT";
export type AppErrorData = { code: ErrorCode; message: string };

/** Throws an error the client can read as `error.data.code` / `error.data.message`. */
export function fail(code: ErrorCode, message: string): never {
  throw new ConvexError<AppErrorData>({ code, message });
}
