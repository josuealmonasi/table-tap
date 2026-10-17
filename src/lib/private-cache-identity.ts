import type { Session } from "@supabase/supabase-js";

/** A cache label, never an authorization check or a stored access token. */
export function privateCacheIdentity(
  session: Session | null,
  restaurantId: string,
  role: string,
): string | null {
  if (!session) return null;
  try {
    const claims = JSON.parse(atob(session.access_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const expires = Math.min(session.expires_at ?? 0, claims.exp);
    const parts = [session.user.id, claims.session_id, restaurantId, role];
    if (!parts.every(p => typeof p === "string" && /^[\w-]+$/.test(p))) return null;
    if (!Number.isFinite(expires) || expires * 1000 <= Date.now()) return null;
    return [...parts, expires].join(":");
  } catch {
    return null;
  }
}
