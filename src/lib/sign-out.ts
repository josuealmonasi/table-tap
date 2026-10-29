import { createClient } from "@/lib/supabase/client";
import { readHeld } from "@/lib/offline-sales";
import { clearPrivateCache } from "@/lib/private-cache";

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
export async function signOutEverywhere(onHeld?: (count: number) => void, canSendHeld = true): Promise<void> {
  // Sales the till rang offline and has not sent live only on this device,
  // and signing out is how a shared tablet gets handed over and cleared.
  // They are the record of money already taken: they go first — when this
  // login can send them. One that cannot (moved to the kitchen while the sales
  // were held) was refused the upload and the sign-out alike, and stayed signed
  // in for good (sweep 3, finding 2). The sales stay on the device either way;
  // signing out never touches them, and the next manager reviews them from
  // Held sales.
  const held = readHeld().length;
  if (held > 0 && canSendHeld) {
    onHeld?.(held);
    return;
  }
  // Best effort, and never allowed to keep somebody signed in: a worker that
  // does not answer still forgets this person — the navigation to /login below
  // retires their pages, and they were bound to this session in any case.
  await clearPrivateCache().catch(() => {});
  const { error } = await createClient().auth.signOut();
  if (error) throw error;

  window.location.assign("/login");
}
