import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@/convex/_generated/api";

/** A tool as `api.tools.list` / `api.tools.get` return it to a signed-in viewer. */
export type ToolView = FunctionReturnType<typeof api.tools.list>[number];

/**
 * True once the viewer's `users` row exists. Queries that call `requireUser` wait for it
 * ("skip" until then): right after the first sign-in, `EnsureUser` is still creating the row,
 * and running them earlier would throw UNAUTHENTICATED into the page. If the row can't be
 * created, EnsureUser's banner says why and the page keeps showing its skeleton.
 */
export function useViewerReady(): boolean {
  const { isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  return Boolean(me);
}
