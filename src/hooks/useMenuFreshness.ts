"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often an open menu re-checks the kitchen, while the tab is visible. */
const EVERY_MS = 45_000;

/**
 * Keeps an open menu close to what the kitchen is actually serving.
 *
 * A diner reads the menu, takes a while to decide, and meanwhile the owner
 * marks the last portion of something sold out. The checkout re-verifies
 * against the database so the money is never at risk — but the payment step
 * is a late and irritating place to learn a dish has gone.
 *
 * This asks the server to re-render, which re-runs the real query with all of
 * its rules intact: availability, which menus are switched on, and whether
 * each is inside its opening hours. Filtering any of that a second time on the
 * client would be a copy to drift out of step.
 *
 * A realtime subscription would seem the obvious choice and cannot work here:
 * the anon read policy on menu_items is `available AND menu is active`, so the
 * instant a dish sells out the diner loses permission to read that row and
 * Postgres changes suppress the event. The only event we care about is exactly
 * the one the policy hides, and loosening a read policy to work around that
 * would trade real security for a UI nicety.
 *
 * Refreshes only while the tab is visible — a phone in a pocket should not be
 * polling — and immediately when the diner comes back to it, which is the
 * moment they are about to act on what they see.
 */
export function useMenuFreshness(): void {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };

    const timer = setInterval(refresh, EVERY_MS);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);
}
