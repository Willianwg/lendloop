"use client";

import { useConvexAuth, useQuery_experimental, type UseQueryResult } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { errorCode } from "@/lib/errors";

/**
 * A reactive Convex query that waits for the Clerk session and returns its error instead of
 * throwing, so a page can show "You don't have access" for a server FORBIDDEN.
 *
 * UNAUTHENTICATED is reported as "pending": right after the first sign-in the `users` row may
 * not exist yet; the query re-runs by itself once `ensureCurrent` creates it (and if that
 * fails, the EnsureUser banner explains why).
 */
export function useAuthedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query> | "skip",
): UseQueryResult<FunctionReturnType<Query>> {
  const { isAuthenticated } = useConvexAuth();
  const result = useQuery_experimental({ query, args: isAuthenticated ? args : "skip" });
  if (!isAuthenticated) return { status: "pending" };
  if (result.status === "error" && errorCode(result.error) === "UNAUTHENTICATED") return { status: "pending" };
  return result;
}
