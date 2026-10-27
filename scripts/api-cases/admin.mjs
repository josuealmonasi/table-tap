import { adminCases } from "../api-admin-cases.mjs";
import { frozenOfferCases } from "../api-frozen-offers.mjs";

export function adminOpeningCases() {
  return [
    ...adminCases(),
    ...frozenOfferCases(),
  ];
}

export function adminOwnerCases(fx) {
  const { restaurant } = fx;
  const r = restaurant.id;
  return [
    // ── owner: money and team ────────────────────────────────────────────
    { name: "POST /api/billing/portal", as: "owner", method: "POST", path: "/api/billing/portal",
      body: {}, expect: [200, 400, 409] },
    // 502 while Stripe Connect is not configured on the platform account: the
    // route reports the upstream failure instead of swallowing it, which is
    // correct. Once Connect exists, this will be a 200.
    // "Conectar Stripe" once accepted 502 as healthy, and so passed every run
    // while Stripe refused every account it was asked to make: no restaurant
    // could connect at all. Dev is on Stripe's test mode, so this makes a real
    // test account, demands the onboarding link, and closes the account again.
    { name: "POST /api/connect/onboard", as: "owner", method: "POST", path: "/api/connect/onboard",
      arrange: async f => {
        const { data: was } = await f.admin.from("restaurants")
          .select("stripe_account_id, stripe_charges_enabled").eq("id", r).single();
        await f.admin.from("restaurants").update({ stripe_account_id: null, stripe_charges_enabled: false }).eq("id", r);
        return async () => {
          const { data: now } = await f.admin.from("restaurants").select("stripe_account_id").eq("id", r).single();
          if (now?.stripe_account_id && now.stripe_account_id !== was?.stripe_account_id) {
            const { default: Stripe } = await import("stripe");
            const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
            await stripe.rawRequest("POST", `/v2/core/accounts/${now.stripe_account_id}/close`,
              { applied_configurations: ["merchant"] }, { apiVersion: "2026-06-24.preview" }).catch(() => {});
          }
          await f.admin.from("restaurants").update({
            stripe_account_id: was?.stripe_account_id ?? null,
            stripe_charges_enabled: was?.stripe_charges_enabled ?? false,
          }).eq("id", r);
        };
      },
      body: {}, expect: [200],
      check: async (d, f) => {
        if (!/^https:\/\/connect\.stripe\.com\//.test(d.url ?? "")) return `no Stripe onboarding link (${JSON.stringify(d).slice(0, 80)})`;
        const { data } = await f.admin.from("restaurants").select("stripe_account_id").eq("id", r).single();
        return /^acct_/.test(data?.stripe_account_id ?? "") || "no Stripe account was stored for the restaurant";
      } },
    { name: "POST /api/billing/checkout", as: "owner", method: "POST", path: "/api/billing/checkout",
      body: { plan: "servicio" }, expect: [200, 400, 409, 502] },

    // ── the routes that destroy things: checked by their refusal ─────────
    //
    // These delete restaurants, delete logins and cancel subscriptions. A case
    // that exercised them for real would be a case that wrecks the demo
    // restaurant, and `pnpm api:prod` would do it to production. What matters
    // and what is safe to assert is the same thing: who is turned away.
    { name: "POST /api/billing/cancel (waiter refused)", as: "waiter", method: "POST",
      path: "/api/billing/cancel", body: {}, expect: [401, 403] },
    { name: "POST /api/admin/users (manager refused)", as: "manager", method: "POST",
      path: "/api/admin/users",
      body: { email: "nobody@tabletap.dev", password: "not-a-real-one", role: "admin" },
      expect: [401, 403] },
    // A platform admin moves a restaurant to another plan, and its team with
    // it. Put back afterwards, trial and all.
    { name: "PATCH /api/admin/restaurants (move a plan)", as: "platformAdmin", method: "PATCH",
      path: "/api/admin/restaurants",
      arrange: async f => {
        const { data: was } = await f.admin.from("restaurants")
          .select("plan, plan_status, trial_ends_at, plan_ends_at").eq("id", r).single();
        const { data: tiers } = await f.admin.from("plan_limits").select("plan").order("rank");
        f.planBefore = was;
        f.planTarget = (tiers ?? []).map(t => t.plan).find(p => p !== was?.plan);
        return async () => {
          await f.admin.from("restaurants").update(was).eq("id", r);
          await f.admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "settings").like("detail", "plan=%by=platform_admin");
        };
      },
      body: f => ({ id: r, plan: f.planTarget }),
      expect: [200],
      check: async (d, f) => {
        const { data } = await f.admin.from("restaurants").select("plan, plan_status").eq("id", r).single();
        return data?.plan === d.to && data?.plan_status === "active" || `the restaurant is on ${data?.plan}/${data?.plan_status}, not ${d.to}`;
      } },
    // An owner cannot give themselves a plan — only the platform admin moves one.
    { name: "PATCH /api/admin/restaurants (an owner refused)", as: "owner", method: "PATCH",
      path: "/api/admin/restaurants",
      arrange: async f => {
        const { data } = await f.admin.from("restaurants").select("plan").eq("id", r).single();
        f.ownerPlanBefore = data?.plan;
        return async () => {};
      },
      body: { id: r, plan: "grupo" }, expect: [403],
      effect: async f => {
        const { data } = await f.admin.from("restaurants").select("plan").eq("id", r).single();
        return data?.plan === f.ownerPlanBefore || `the owner moved their own plan to ${data?.plan}`;
      } },
    { name: "DELETE /api/admin/restaurants (manager refused)", as: "manager", method: "DELETE",
      path: "/api/admin/restaurants", body: async f => ({ id: f.restaurant.id }),
      expect: [401, 403] },
  ];
}
