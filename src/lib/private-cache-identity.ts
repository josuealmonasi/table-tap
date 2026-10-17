import type { Session } from "@supabase/supabase-js";

/**
 * How long a board or till saved on this device can be opened with no
 * connection, counted from the last moment it was online and signed in.
 *
 * A service, not an access token: the token lasts an hour and cannot refresh
 * offline, so a label that died with it left a till reloaded an hour into an
 * outage with nothing to sell from. The session still has to be live to start
 * the window, every auth refresh moves it on, and signing out ends it at once.
 */
export const OFFLINE_WINDOW_S = 12 * 60 * 60;

/**
 * A cache label, never an authorization check or a stored access token:
 * `user:session:restaurant:role:until`. The worker keeps one person's pages
 * under the first four, and stops serving them offline at `until`.
 */
export function privateCacheIdentity(
  session: Session | null,
  restaurantId: string,
  role: string,
): string | null {
  if (!session) return null;
  try {
    const claims = JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const tokenExpires = Math.min(session.expires_at ?? 0, claims.exp);
    const parts = [session.user.id, claims.session_id, restaurantId, role];
    if (!parts.every(p => typeof p === "string" && /^[\w-]+$/.test(p))) return null;
    if (!Number.isFinite(tokenExpires) || tokenExpires * 1000 <= Date.now()) return null;
    // To the minute, so the server's label and the browser's agree.
    const until = Math.floor(Date.now() / 60_000) * 60 + OFFLINE_WINDOW_S;
    return [...parts, until].join(":");
  } catch {
    return null;
  }
}
