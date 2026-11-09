"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production builds only: in dev it would cache
 * hot-reloaded chunks and hide changes.
 */
export function SwRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the app works without it, only the offline page is lost.
    });
  }, []);
  return null;
}
