import type { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api-error";
import { parsePlanLimit, planLimitText } from "@/lib/plan-error";
import { planLabel } from "@/lib/plan";

export async function inviteStaff(restaurantId: string, email: string, role: string, origin: string): Promise<NextResponse | null> {
  const admin = createAdminClient();

  // Create the password-less login without sending mail. The staff insert
  // reserves the seat before any link can reach somebody's inbox.
  const { data: created, error: createErr } = await admin.auth.admin.createUser({ email, email_confirm: false });
  if (createErr || !created.user) return await inviteError(createErr);

  const { error: staffErr } = await admin.from("staff").insert({
    restaurant_id: restaurantId,
    user_id: created.user.id,
    email,
    role,
  });
  if (staffErr) {
    await admin.auth.admin.deleteUser(created.user.id); // No invitation has left yet.
    const hit = parsePlanLimit(staffErr.message);
    if (hit) {
      const text = planLimitText(hit);
      return await apiError(text.key, 403, { ...text.vars, plan: planLabel(hit.plan) });
    }
    return await apiError("apiErr.staffAdd", 500);
  }

  // The membership is committed before the invite leaves. They set their
  // own password via the link → /auth/callback → /reset-password.
  let inviteErr: { message: string } | null;
  try {
    const result = await admin.auth.admin.inviteUserByEmail(
      email, { redirectTo: `${origin}/auth/callback?next=/reset-password` },
    );
    inviteErr = result.error ?? (result.data.user ? null : { message: "Invite returned no user" });
  } catch (error) {
    inviteErr = { message: error instanceof Error ? error.message : "Invite failed" };
  }
  if (inviteErr) {
    // Free the seat even if Auth cannot delete the new login just now. Deleting
    // our own new login also cascades its membership away if that write failed.
    const { error: seatError } = await admin.from("staff").delete()
      .eq("restaurant_id", restaurantId).eq("user_id", created.user.id);
    const { error: userError } = await admin.auth.admin.deleteUser(created.user.id);
    if (seatError || userError) console.error("staff invite cleanup failed", seatError?.message, userError?.message);
    if (seatError && userError) return await apiError("apiErr.staffAdd", 500);
    return await inviteError(inviteErr);
  }

  return null;
}

async function inviteError(error: { message: string } | null) {
  const raw = error?.message?.toLowerCase() ?? "";
  const already = raw.includes("already");
  // Supabase says "invalid" or "rate limit" when it is the one that cannot send
  // the mail, not when the address is wrong. Telling the owner their waiter's
  // email is invalid sends them to check the one thing that is actually fine.
  const mailer = raw.includes("rate limit") || raw.includes("invalid");
  console.error("staff invite failed", error?.message);
  return await apiError(
    already ? "apiErr.emailHasAccount" : mailer ? "apiErr.inviteMailerOff" : "apiErr.inviteFailed",
    400,
  );
}

