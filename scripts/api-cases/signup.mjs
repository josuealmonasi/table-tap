import { createHash, randomBytes } from "node:crypto";
import { MARK } from "../api-fixtures.mjs";
import { loginByEmail } from "../logins.mjs";
import { loginSecret } from "../login-secrets.mjs";

const hash = value => createHash("sha256").update(value).digest("hex");
const trial = { plan: "servicio", status: "trialing" };

async function arrangeSignup(f, { token, expired = false } = {}) {
  f.signupEmail = `${MARK}-signup-${randomBytes(6).toString("hex")}@example.com`;
  f.signupName = `${MARK} ${f.signupEmail}`;
  if (token) {
    const { error } = await f.admin.from("pending_signups").insert({
      email_hash: hash(f.signupEmail), token_hash: hash(token),
      payload: {
        email: f.signupEmail, restaurantName: f.signupName, locale: "es",
        termsVersion: "gate-signup", termsTextHash: hash("gate signup terms"),
      },
      expires_at: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(),
    });
    if (error) throw new Error(`Could not seed signup confirmation: ${error.message}`);
  }
  return async () => {
    await f.admin.from("pending_signups").delete().eq("email_hash", hash(f.signupEmail));
    const { data: restaurant } = await f.admin.from("restaurants").select("id").eq("name", f.signupName).maybeSingle();
    await f.admin.from("restaurants").delete().eq("name", f.signupName);
    if (restaurant) await f.admin.from("restaurant_accounting_records").delete().eq("restaurant_id", restaurant.id);
    const user = await loginByEmail(f.admin, f.signupEmail);
    if (user) await f.admin.auth.admin.deleteUser(user.id);
  };
}

async function noSignupAccount(f) {
  const { data, error } = await f.admin.from("restaurants").select("id").eq("name", f.signupName).maybeSingle();
  if (error) return error.message;
  if (data || await loginByEmail(f.admin, f.signupEmail)) return "created a restaurant or login before confirmation";
  return true;
}

export function signupCases() {
  const confirmToken = randomBytes(32).toString("hex");
  const expiredToken = randomBytes(32).toString("hex");
  return [
    { name: "POST /api/signup/resend (rejects an empty address)", as: "diner", method: "POST",
      path: "/api/signup/resend", body: {}, expect: [400, 429] },
    { name: "POST /api/signup (rejects an empty form)", as: "diner", method: "POST",
      path: "/api/signup", body: {}, expect: [400, 429] },
    { name: "POST /api/signup (refuses a restaurant name over 80 characters)", as: "diner", method: "POST",
      path: "/api/signup", arrange: f => arrangeSignup(f),
      body: f => ({ restaurantName: "x".repeat(81), email: f.signupEmail, acceptedTerms: true }),
      expect: [400], expectError: /80/, known: "five signups a minute is the ceiling; this run spent it",
      effect: async f => {
        const { data, error } = await f.admin.from("pending_signups").select("id").eq("email_hash", hash(f.signupEmail));
        if (error) return error.message;
        return data.length ? "stored a pending signup for a refused name" : true;
      } },
    { name: "POST /api/password-reset (rejects an empty address)", as: "diner", method: "POST",
      path: "/api/password-reset", body: {}, expect: [400, 429] },
    // An address with no account: the answer must be the one a real account
    // gets, and Auth sends nothing, so the case leaves no mail behind.
    { name: "POST /api/password-reset (answers the same for an unknown address)", as: "diner", method: "POST",
      path: "/api/password-reset", body: { email: `${MARK}-reset-${randomBytes(6).toString("hex")}@example.com` },
      expect: [200], known: "five reset requests a minute is the ceiling; this run spent it",
      check: data => JSON.stringify(data) === JSON.stringify({ ok: true }) || `answered ${JSON.stringify(data)}` },
    { name: "POST /api/signup (keeps only a pending signup)", as: "diner", method: "POST",
      path: "/api/signup", arrange: f => arrangeSignup(f),
      body: f => ({ restaurantName: f.signupName, email: f.signupEmail, acceptedTerms: true }),
      expect: [200], known: "five signups a minute is the ceiling; this run spent it",
      effect: async f => {
        const { data, error } = await f.admin.from("pending_signups").select("payload, expires_at")
          .eq("email_hash", hash(f.signupEmail)).maybeSingle();
        if (error) return error.message;
        if (!data || !data.expires_at || "password" in data.payload) return "expected one expiring, password-free signup";
        return await noSignupAccount(f);
      } },
    { name: "POST /api/signup/confirm (an expired link cannot create a login)", as: "diner", method: "POST",
      path: "/api/signup/confirm", arrange: f => arrangeSignup(f, { token: expiredToken, expired: true }),
      body: () => ({ token: expiredToken, password: loginSecret("TEST_PASSWORD") }),
      expect: [410], effect: noSignupAccount },
    { name: "POST /api/signup/confirm (opens the restaurant and trial)", as: "diner", method: "POST",
      path: "/api/signup/confirm", arrange: f => arrangeSignup(f, { token: confirmToken }),
      body: () => ({ token: confirmToken, password: loginSecret("TEST_PASSWORD") }),
      expect: [200], known: "five confirmation attempts a minute is the ceiling; this run spent it",
      effect: async f => {
        const user = await loginByEmail(f.admin, f.signupEmail);
        if (!user?.email_confirmed_at) return "confirmed no login";
        const { data: r, error } = await f.admin.from("restaurants")
          .select("owner_id, owner_signup_pending, plan, plan_status, trial_ends_at, terms_version, terms_accepted_email")
          .eq("name", f.signupName).maybeSingle();
        if (error) return error.message;
        if (r?.owner_id !== user.id || r.owner_signup_pending) return "the verified owner cannot open the restaurant";
        if (r.plan !== trial.plan || r.plan_status !== trial.status || !r.trial_ends_at) return "the Servicio trial did not start";
        if (r.terms_version !== "gate-signup" || r.terms_accepted_email !== f.signupEmail) return "the terms acceptance was lost";
        const { data: pending, error: pendingError } = await f.admin.from("pending_signups").select("id")
          .eq("token_hash", hash(confirmToken)).maybeSingle();
        if (pendingError) return pendingError.message;
        return pending ? "the confirmation link remained usable" : true;
      } },
  ];
}
