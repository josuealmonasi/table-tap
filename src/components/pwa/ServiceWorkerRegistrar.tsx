"use client";

import { useEffect } from "react";

/**
 * Registers the worker that keeps the kitchen board alive through a drop.
 *
 * Nothing renders. It is mounted from the dashboard layout, so it never runs on
 * a diner's screen: a diner who loses the connection should see that they have,
 * not an old menu with prices that may have moved.
 *
 * Failure is silent by design — a browser with service workers switched off, or
 * an insecure origin, gets the app exactly as it was before this existed.
 */
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Private mode, an unsupported browser, or http. Not worth a message:
      // the app works, it just will not survive losing the connection.
    });
  }, []);

  return null;
}
