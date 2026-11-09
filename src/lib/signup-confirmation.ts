import { createAdminClient } from "@/lib/supabase/admin";
import { siteOrigin } from "@/lib/site-origin";

/** The callback opens a server session before starting the restaurant's trial. */
export async function sendSignupConfirmation(req: Request, email: string): Promise<boolean> {
  try {
    const { error } = await createAdminClient().auth.resend({ type: "signup", email,
      options: { emailRedirectTo: `${siteOrigin(req)}/auth/callback?next=/signup/complete` } });
    if (error) console.error("signup confirmation failed:", error.message);
    return !error;
  } catch {
    return false;
  }
}
