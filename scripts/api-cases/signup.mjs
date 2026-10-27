import { MARK } from "../api-fixtures.mjs";
import { loginByEmail } from "../logins.mjs";

export function signupCases() {
  return [
    { name: "POST /api/signup (rejects an empty form)", as: "diner", method: "POST",
      path: "/api/signup", body: {}, expect: [400, 429] },
    // The front door, which nothing had ever opened. The only case here
    // refused an empty form — and accepted a rate-limit answer as a pass, so
    // it could be satisfied without the route validating anything.
    //
    // This one signs a restaurant up for real and then takes it away again:
    // `arrange` hands back the undo, which removes the restaurant and the
    // login whatever the case does. A 429 is reported as a skipped line rather
    // than a pass, because five attempts a minute is a real ceiling and three
    // runs back to back will find it.
    { name: "POST /api/signup (a restaurant opens an account)", as: "diner",
      method: "POST", path: "/api/signup",
      arrange: async f => {
        f.signupEmail = `${MARK}-signup-${Date.now()}@tabletap.dev`;
        f.signupName = `${MARK} signup ${Date.now()}`;
        return async () => {
          await f.admin.from("restaurants").delete().eq("name", f.signupName);
          const user = await loginByEmail(f.admin, f.signupEmail);
          if (user) await f.admin.auth.admin.deleteUser(user.id).catch(() => {});
        };
      },
      body: async f => ({
        restaurantName: f.signupName, email: f.signupEmail,
        password: "longenough1", acceptedTerms: true,
      }),
      expect: [200],
      known: "five signups a minute is the ceiling; this run spent it",
      effect: async (f, status) => {
        if (status !== 200) return true;
        const { data: r } = await f.admin
          .from("restaurants").select("*").eq("name", f.signupName).maybeSingle();
        if (!r) return "answered ok and created no restaurant";
        // A month of everything, no card — and the terms they agreed to, which
        // is only worth something if we can say which document it was.
        if (r.plan_status !== "trialing") return `the trial opened as "${r.plan_status}"`;
        if (!r.trial_ends_at) return "the trial has no end";
        if (!r.terms_version || r.terms_accepted_email !== f.signupEmail) {
          return "the terms they accepted were not written down against them";
        }
        // And the owner is the person who signed up: `getMembership` reads
        // `restaurants.owner_id` before it looks at the staff table, which is
        // why a founding owner needs no staff row.
        const user = await loginByEmail(f.admin, f.signupEmail);
        if (!user) return "answered ok and created no login";
        if (r.owner_id !== user.id) return "the restaurant belongs to somebody else";
        return true;
      } },
  ];
}
