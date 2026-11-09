"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { errorMessage } from "@/lib/errors";

/**
 * Creates or refreshes the viewer's Convex `users` row from the verified Clerk token, once per
 * page load after Convex has the token. If that fails (for example, the session token lacks the
 * `email` claim), it shows the server's message in a banner instead of failing silently. The
 * banner can't be dismissed: without the account row the pages can't load, and hiding the
 * reason would leave the user staring at skeletons.
 */
export function EnsureUser() {
  const { isAuthenticated } = useConvexAuth();
  const ensureCurrent = useMutation(api.users.ensureCurrent);
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || started.current) return;
    started.current = true;
    ensureCurrent().catch((e: unknown) => setError(errorMessage(e)));
  }, [isAuthenticated, ensureCurrent]);

  if (!error) return null;
  return (
    <div
      role="alert"
      className="mb-5 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium">We couldn&apos;t set up your account.</p>
        <p className="mt-0.5 text-muted-foreground">{error}</p>
      </div>
    </div>
  );
}
