import { createClient } from "@/lib/supabase/client";
import { readHeld } from "@/lib/offline-sales";

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
export async function signOutEverywhere(onHeld?: (count: number) => void): Promise<void> {
  // Sales the till rang offline and has not sent live only on this device,
  // and signing out is how a shared tablet gets handed over and cleared.
  // They are the record of money already taken: they go first.
  const held = readHeld().length;
  if (held > 0) {
    onHeld?.(held);
    return;
  }
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
