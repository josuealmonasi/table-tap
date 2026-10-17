"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { privateCacheIdentity } from "@/lib/private-cache-identity";

/**
 * Registers the worker that keeps the kitchen board alive through a drop.
 *
 * Watches auth outside the dashboard too: signing in on a shared tablet must
 * retire the last person's board before the next dropped connection.
 *
 * Failure is silent by design — a browser with service workers switched off, or
 * an insecure origin, gets the app exactly as it was before this existed.
 */
export default function ServiceWorkerRegistrar({ identity }: { identity: string | null }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const workers = navigator.serviceWorker;
    let current: string | null | undefined;
    let retire = true;
    let disposed = false;
    const notify = () => {
      // Auth has not answered yet. Treating that wait as sign-out loses a
      // valid offline till whenever a new worker takes control first.
      if (current !== undefined) workers.controller?.postMessage({ type: "IDENTITY", identity: current, retire });
    };
    const { data: { subscription } } = createClient().auth.onAuthStateChange((_event, session) => {
      const parts = identity?.split(":");
      current = parts ? privateCacheIdentity(session, parts[2], parts[3]) : null;
      // An expired token needs fresh server proof, but its auth session may
      // still refresh. Sign-out and a changed identity retire the old label.
      retire = !session || current !== null;
      // A cached root layout cannot vouch for a new browser session.
      if (current?.split(":").slice(0, 2).join(":") !== parts?.slice(0, 2).join(":")) current = null;
      notify();
    });
    workers.addEventListener("controllerchange", notify);
    if (identity) {
      void workers.register("/sw.js").then(() => workers.ready).then(() => {
        if (!disposed) notify();
      }).catch(() => {
        // The page still works in browsers that refuse service workers.
      });
    }
    return () => {
      disposed = true;
      subscription.unsubscribe();
      workers.removeEventListener("controllerchange", notify);
    };
  }, [identity]);

  return null;
}
