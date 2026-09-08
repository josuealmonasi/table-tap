import { createClient } from "@/lib/supabase/client";

/**
 * Ends the session and leaves nothing of it behind.
 *
 * The service worker keeps the last kitchen board so the pass can keep working
 * through a dropped connection, and that board is a signed-in page. Whoever
 * signs in next on a shared tablet — which is most tablets in a restaurant —
 * must not be one dropped connection away from the previous person's orders.
 *
 * Written once because it was written twice: the navbar and the drawer each had
 * their own copy, so a change like this one would have had to be remembered in
 * both.
 */
export async function signOutEverywhere(): Promise<void> {
  await createClient().auth.signOut();

  // Best effort, and never allowed to keep somebody signed in: if the worker
  // cannot be reached, the sign-out still happens.
  try {
    navigator.serviceWorker?.controller?.postMessage("CLEAR");
  } catch {
    // No worker registered, or a browser that does not support one.
  }

  window.location.assign("/login");
}
