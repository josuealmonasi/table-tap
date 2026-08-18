import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-error";
import { TERMS_VERSION } from "@/lib/legal";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

/** What a new restaurant gets, and for how long, before a card is needed. */
const TRIAL_PLAN = "casa";
const TRIAL_DAYS = 30;

// POST /api/signup
// Body: { restaurantName, email, password }
// Creates a pre-confirmed auth user and their restaurant, atomically-ish:
// if the restaurant insert fails we remove the just-created user so a retry works.
export async function POST(req: NextRequest) {
  // Cap account-creation attempts per IP to blunt signup spam.
  if (await isRateLimited(`signup:${clientIp(req)}`, 5, 60)) {
    return await apiError("apiErr.tooManyAttempts", 429);
  }

  const { restaurantName, email, password, acceptedTerms } = await req.json();

  // Checked on the server too. The box in the browser is the honest place to
  // ask; this is the place that makes the answer mean something.
  if (!acceptedTerms) return await apiError("auth.termsRequired", 400);

  if (!restaurantName?.trim() || !email || !password || password.length < 6) {
    return await apiError("apiErr.signupFields", 400);
  }

  const admin = createAdminClient();

  // Pre-confirm the email so there's no verification step for now.
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (userErr || !created?.user) {
    return NextResponse.json(
      { error: userErr?.message ?? "Could not create the account." },
      { status: 400 },
    );
  }

  const { error: restaurantErr } = await admin
    .from("restaurants")
    .insert({
      name: restaurantName.trim(),
      owner_id: created.user.id,
      // A month of everything, no card. Sold on the top self-serve tier
      // because a restaurant deciding whether this is worth paying for should
      // be deciding about the product, not about a cut-down version of it.
      plan: TRIAL_PLAN,
      plan_status: "trialing",
      // What they agreed to and when. Versioned, because "they accepted" is
      // only worth something if we can say which document they accepted.
      terms_version: TERMS_VERSION,
      terms_accepted_at: new Date().toISOString(),
      terms_accepted_email: email,
      trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString(),
    });

  if (restaurantErr) {
    // Roll back the orphaned user so the email is free to try again.
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: restaurantErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
