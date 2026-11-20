import { cache } from "react";
import { isAuthRetryableFetchError, type User } from "@supabase/supabase-js";
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
 * Resolve admin identity and assurance together. The shared layout can reuse
 * the current user lookup, and only an enrolled admin needs a token check.
 */
const platformAdminSession = cache(async (): Promise<{ admin: PlatformAdmin; mfa: AdminMfa } | null> => {
  const user = await currentUser();
  if (!user) return null;

  // The table has no client policies, so this lookup uses the service client.
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
  return data ? { admin: { userId: data.user_id, email: data.email }, mfa: await assurance(user) } : null;
});

async function assurance(user: User): Promise<AdminMfa> {
  const enrolled = user.factors?.some(f => f.status === "verified" && f.factor_type === "totp");
  if (!enrolled) return "not-enrolled";

  const { auth } = await createClient();
  const { data: { session }, error: sessionError } = await auth.getSession();
  if (sessionError && isAuthRetryableFetchError(sessionError)) throw sessionError;
  if (sessionError || !session?.access_token) return "needs-code";

  // A session read can refresh or fall back to another token. Verify this
  // exact token and match its user to the admin before trusting its assurance.
  const token = session.access_token;
  const { data: { user: tokenUser }, error: userError } = await auth.getUser(token);
  if (userError && isAuthRetryableFetchError(userError)) throw userError;
  if (userError || tokenUser?.id !== user.id) return "needs-code";

  try {
    const { aal } = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return aal === "aal2" ? "verified" : "needs-code";
  } catch {
    return "needs-code";
  }
}

export async function platformAdminMfa(): Promise<AdminMfa> {
  return (await platformAdminSession())?.mfa ?? "not-enrolled";
}

/**
 * The logged-in user as a platform admin, or null. Once the admin has turned on
 * two-step verification, a session signed in with the password alone is NOT an
 * admin until it enters the code: every admin page and action asks this.
 */
export async function getPlatformAdmin(): Promise<PlatformAdmin | null> {
  const session = await platformAdminSession();
  return session && session.mfa !== "needs-code" ? session.admin : null;
}

/** A platform admin who still has to enter their code (sent to /dashboard/admin/mfa). */
export async function pendingPlatformAdmin(): Promise<boolean> {
  return (await platformAdminSession())?.mfa === "needs-code";
}

/** The admin row, verified or not: for the page that asks for the code. */
export async function platformAdminForMfa(): Promise<PlatformAdmin | null> {
  return (await platformAdminSession())?.admin ?? null;
}
