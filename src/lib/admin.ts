import { cache } from "react";
import { currentUser } from "@/lib/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export interface PlatformAdmin {
  userId: string;
  email: string;
}

/** Where a platform admin's second step stands. */
export type AdminMfa = "not-enrolled" | "needs-code" | "verified";

/**
 * The platform_admins row for the logged-in user, whatever their second step.
 * The table has no client policies, so the check always runs with the secret
 * key — a client can't fake or even see admin status.
 */
const platformAdminRow = cache(async (): Promise<PlatformAdmin | null> => {
  const user = await currentUser();
  if (!user) return null;
  // `maybeSingle`, because `single` reports "no row" as an error — which every
  // request from a non-admin was, a 406 in the database log each time — and
  // that made a real failure look exactly like an answer. Now an error is a
  // failure, and it is thrown rather than read as "not an admin".
  const { data, error } = await createAdminClient()
    .from("platform_admins")
    .select("user_id, email")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`platform admin lookup failed: ${error.message}`);
  return data ? { userId: data.user_id, email: data.email } : null;
});

/**
 * Whether this session passed the admin's authenticator code. Enrolment comes
 * from the user `currentUser()` (getUser) verified with the auth server, and
 * the level from that same access token's `aal` claim. Not the library's
 * getAuthenticatorAssuranceLevel(): it reads `session.user`, which logs the
 * unverified-user warning on every admin request.
 */
export const platformAdminMfa = cache(async (): Promise<AdminMfa> => {
  const user = await currentUser();
  const enrolled = (user?.factors ?? []).some(f => f.status === "verified" && f.factor_type === "totp");
  if (!enrolled) return "not-enrolled";
  const { data } = await (await createClient()).auth.getSession();
  const token = data.session?.access_token ?? "";
  let aal: unknown = null;
  try {
    aal = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")).aal;
  } catch { aal = null; }
  return aal === "aal2" ? "verified" : "needs-code";
});

/**
 * The logged-in user as a platform admin, or null. Once the admin has turned on
 * two-step verification, a session signed in with the password alone is NOT an
 * admin until it enters the code: every admin page and action asks this.
 */
export const getPlatformAdmin = cache(async (): Promise<PlatformAdmin | null> => {
  const admin = await platformAdminRow();
  if (!admin) return null;
  return (await platformAdminMfa()) === "needs-code" ? null : admin;
});

/** A platform admin who still has to enter their code (sent to /dashboard/admin/mfa). */
export const pendingPlatformAdmin = cache(async (): Promise<boolean> => {
  return Boolean(await platformAdminRow()) && (await platformAdminMfa()) === "needs-code";
});

/** The admin row, verified or not: for the page that asks for the code. */
export const platformAdminForMfa = platformAdminRow;
