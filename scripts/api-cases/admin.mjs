import { randomUUID } from "node:crypto";
import { adminCases } from "../api-admin-cases.mjs";
import { loginSecret } from "../login-secrets.mjs";
import { frozenOfferCases } from "../api-frozen-offers.mjs";

export function adminOpeningCases() {
  return [
    ...adminCases(),
    ...frozenOfferCases(),
    { name: "POST /api/admin/plan-price-changes", as: "platformAdmin", method: "POST",
      path: "/api/admin/plan-price-changes", expect: [200],
      arrange: async f => {
        const regular = randomUUID(), founding = randomUUID(), other = randomUUID();
        const effectiveAt = new Date(Date.now() + 40 * 86400000).toISOString();
        const price = Math.floor(100000000 + Math.random() * 900000000);
        f.priceNoticeProbe = { regular, founding, other, effectiveAt, price };
        const cleanup = async () => {
          const changes = await f.admin.from("plan_price_changes").delete()
            .eq("new_monthly_price", price).eq("effective_at", effectiveAt);
          if (changes.error) throw new Error(`Price change cleanup: ${changes.error.message}`);
          const restaurants = await f.admin.from("restaurants").delete().in("id", [regular, founding, other]);
          if (restaurants.error) throw new Error(`Price fixture cleanup: ${restaurants.error.message}`);
        };
        try {
          // A negative founding number cannot collide with the normal positive sequence.
          const { error } = await f.admin.from("restaurants").insert([
            { id: regular, name: "Price notice regular", plan: "casa", plan_status: "active" },
            { id: founding, name: "Price notice founding", plan: "casa", plan_status: "active", founding_number: -price },
            { id: other, name: "Price notice other plan", plan: "carta", plan_status: "active" },
          ]);
          if (error) throw new Error(`Price fixture: ${error.message}`);
          return cleanup;
        } catch (error) { await cleanup(); throw error; }
      },
      body: f => ({ plan: "casa", newPrice: f.priceNoticeProbe.price, effectiveAt: f.priceNoticeProbe.effectiveAt }),
      check: async (data, f) => {
        const { regular, founding, other } = f.priceNoticeProbe;
        if (!data.id) return "no price change id";
        const { data: notices, error } = await f.admin.from("plan_price_notices")
          .select("restaurant_id, sent_at, attempts").eq("change_id", data.id).in("restaurant_id", [regular, founding, other]);
        return !error && notices.length === 1 && notices[0].restaurant_id === regular
          && notices[0].sent_at === null && notices[0].attempts === 0 || "wrong notice recipients";
      } },
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
    // It needs a real Stripe test key: on GitHub without STRIPE_TEST_SECRET it
    // is skipped by name (`needsStripe`), never passed.
    { name: "POST /api/connect/onboard", as: "owner", method: "POST", path: "/api/connect/onboard", needsStripe: true,
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
    // Stripe signs an owner into the dashboard only once onboarding is done,
    // which a test account never finishes; what can be checked is the refusal.
    { name: "POST /api/connect/dashboard (no account yet)", as: "owner", method: "POST", path: "/api/connect/dashboard",
      arrange: async f => {
        const { data: was } = await f.admin.from("restaurants").select("stripe_account_id").eq("id", r).single();
        await f.admin.from("restaurants").update({ stripe_account_id: null }).eq("id", r);
        return async () => { await f.admin.from("restaurants").update({ stripe_account_id: was?.stripe_account_id ?? null }).eq("id", r); };
      },
      body: {}, expect: [409], expectError: /Conecta tu cuenta de Stripe|Connect your Stripe account/i },
    { name: "POST /api/billing/checkout", as: "owner", method: "POST", path: "/api/billing/checkout",
      // The price the Plan page shows rides with the choice (E3): founding while places are left.
      body: async f => {
        const { count } = await f.admin.from("restaurants").select("id", { count: "exact", head: true }).not("founding_number", "is", null);
        return { plan: "servicio", founding: (count ?? 0) < 50 };
      },
      expect: [200, 400, 409, 502] },
    { name: "POST /api/billing/checkout (a price the page no longer shows)", as: "owner", method: "POST", path: "/api/billing/checkout",
      body: async f => {
        const { count } = await f.admin.from("restaurants").select("id", { count: "exact", head: true }).not("founding_number", "is", null);
        return { plan: "servicio", founding: (count ?? 0) >= 50 };
      },
      expect: [409], expectError: /fundador|founding/i },

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
      body: () => ({ email: "nobody@tabletap.dev", password: loginSecret("TEST_PASSWORD"), role: "admin" }),
      expect: [401, 403] },
    { name: "GET /api/admin/restaurants/usage", as: "platformAdmin", method: "GET",
      path: `/api/admin/restaurants/usage?id=${r}`, expect: [200],
      check: d => Number.isInteger(d.staff) && Number.isInteger(d.last30?.orders) && Number.isInteger(d.month?.orders)
        || "usage figures missing" },
    { name: "GET /api/admin/restaurants/usage (owner refused)", as: "owner", method: "GET",
      path: `/api/admin/restaurants/usage?id=${r}`, expect: [403] },
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
    // A tier assigned with billing: refused where there is nothing to bill.
    // The happy paths email a real owner and change a Stripe subscription, so
    // they are proved in src/lib/__tests__/admin-tier.spec.ts, not here.
    { name: "PATCH /api/admin/restaurants (Carta by payment link refused)", as: "platformAdmin", method: "PATCH",
      path: "/api/admin/restaurants", body: { id: r, plan: "carta", billing: "payment_link" },
      expect: [400], expectError: /Carta/ },
    { name: "PATCH /api/admin/restaurants (pay-by date in the past refused)", as: "platformAdmin", method: "PATCH",
      path: "/api/admin/restaurants", body: { id: r, plan: "casa", billing: "payment_link", payBy: "2020-01-01" },
      expect: [400], expectError: /fecha|date/i },
    { name: "PATCH /api/admin/restaurants (unknown billing refused)", as: "platformAdmin", method: "PATCH",
      path: "/api/admin/restaurants", body: { id: r, plan: "casa", billing: "forever-free" }, expect: [400] },
    // The emailed pay link opens Checkout only for a tier that was assigned and
    // is unpaid. Asked for another tier, it lands on the Plan screen instead.
    { name: "GET  /api/billing/assigned (a tier nobody assigned)", as: "owner", method: "GET",
      path: "/api/billing/assigned?plan=grupo", expect: [200] },
    { name: "GET  /api/billing/assigned (not the owner)", as: "waiter", method: "GET",
      path: "/api/billing/assigned?plan=casa", expect: [200] },
    // Suspension: the admin suspends and lifts; the demo is put back either way.
    { name: "POST /api/admin/restaurants/suspend (suspend, then lifted)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/suspend",
      arrange: async f => async () => {
        await f.admin.from("restaurants").update({ suspended_at: null, suspended_reason: null, suspended_by: null }).eq("id", r);
        await f.admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "settings").like("detail", "suspended=%");
      },
      body: { id: r, reason: "owner_request" }, expect: [200],
      check: async (_d, f) => {
        const { data } = await f.admin.from("restaurants").select("suspended_at, suspended_reason").eq("id", r).single();
        if (!data?.suspended_at || data.suspended_reason !== "owner_request") return "the restaurant was not suspended";
        const res = await fetch(f.base + "/api/admin/restaurants/suspend", { method: "DELETE",
          headers: { "Content-Type": "application/json", cookie: f.who.platformAdmin }, body: JSON.stringify({ id: r }) });
        const { data: after } = await f.admin.from("restaurants").select("suspended_at").eq("id", r).single();
        return (res.status === 200 && after?.suspended_at === null) || `lifting answered ${res.status}`;
      } },
    { name: "POST /api/admin/restaurants/suspend (an owner refused)", as: "owner", method: "POST",
      path: "/api/admin/restaurants/suspend", body: { id: r, reason: "abuse" }, expect: [403] },
    { name: "POST /api/admin/restaurants/suspend (unknown reason refused)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/suspend", body: { id: r, reason: "because" }, expect: [400] },
    // Owner transfer: a kitchen login becomes the owner and the owner stays on
    // as a manager; the demo's owner and team are put back exactly.
    { name: "POST /api/admin/restaurants/owner (transferred, then put back)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/owner",
      arrange: async f => {
        const { data: rest } = await f.admin.from("restaurants").select("owner_id").eq("id", r).single();
        const { data: member } = await f.admin.from("staff").select("*").eq("restaurant_id", r).eq("role", "kitchen")
          .order("id").limit(1).single();
        f.transfer = { owner: rest?.owner_id, member };
        return async () => {
          await f.admin.from("restaurants").update({ owner_id: rest.owner_id }).eq("id", r);
          await f.admin.from("staff").delete().eq("restaurant_id", r).in("user_id", [rest.owner_id, member.user_id]);
          await f.admin.from("staff").insert(member);
          await f.admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "settings").like("detail", "owner=%");
        };
      },
      body: f => ({ id: r, userId: f.transfer.member.user_id }), expect: [200],
      check: async (_d, f) => {
        const { owner, member } = f.transfer;
        const { data: rest } = await f.admin.from("restaurants").select("owner_id").eq("id", r).single();
        const { data: team } = await f.admin.from("staff").select("user_id, role").eq("restaurant_id", r).in("user_id", [owner, member.user_id]);
        if (rest?.owner_id !== member.user_id) return "the restaurant did not change owner";
        if (team?.some(t => t.user_id === member.user_id)) return "the new owner still has a staff row";
        return team?.some(t => t.user_id === owner && t.role === "manager") || "the former owner did not stay on as a manager";
      } },
    { name: "POST /api/admin/restaurants/owner (someone off the team refused)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/owner", body: { id: r, userId: randomUUID() }, expect: [409],
      expectError: /equipo|team/i },
    { name: "POST /api/admin/restaurants/owner (malformed ids refused, not uncertain)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/owner", body: { id: "abc", userId: "x" }, expect: [400] },
    { name: "POST /api/admin/restaurants/owner (an owner refused)", as: "owner", method: "POST",
      path: "/api/admin/restaurants/owner", body: { id: r, userId: randomUUID() }, expect: [403] },
    // Trial control: the demo is not on a trial, so ending one is the right refusal.
    { name: "PATCH /api/admin/restaurants/trial (not on a trial refused)", as: "platformAdmin", method: "PATCH",
      path: "/api/admin/restaurants/trial", body: { id: r, endsAt: null }, expect: [409],
      expectError: /prueba|trial/i },
    { name: "PATCH /api/admin/restaurants/trial (an owner refused)", as: "owner", method: "PATCH",
      path: "/api/admin/restaurants/trial", body: { id: r, endsAt: null }, expect: [403] },
    // Support notes: the admin writes one and reads it back; cleaned up after.
    { name: "POST /api/admin/restaurants/notes (add a note)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/notes",
      arrange: async f => async () => { await f.admin.from("restaurant_admin_notes").delete().eq("restaurant_id", r).like("body", "apicheck note%"); },
      body: { id: r, body: "apicheck note: called about the card reader" }, expect: [200],
      check: async (_d, f) => {
        const res = await fetch(`${f.base}/api/admin/restaurants/notes?id=${r}`, { headers: { cookie: f.who.platformAdmin } });
        const { notes } = await res.json();
        return notes?.some(n => n.body.startsWith("apicheck note")) || "the note was not read back";
      } },
    { name: "GET  /api/admin/restaurants/notes (an owner refused)", as: "owner", method: "GET",
      path: `/api/admin/restaurants/notes?id=${r}`, expect: [403] },
    // The owner's reset email goes to a real address, so only refusals run here.
    { name: "POST /api/admin/restaurants/owner-reset (an owner refused)", as: "owner", method: "POST",
      path: "/api/admin/restaurants/owner-reset", body: { id: r }, expect: [403] },
    { name: "POST /api/admin/restaurants/owner-reset (no such restaurant)", as: "platformAdmin", method: "POST",
      path: "/api/admin/restaurants/owner-reset", body: { id: "00000000-0000-4000-8000-000000000000" }, expect: [404] },
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
