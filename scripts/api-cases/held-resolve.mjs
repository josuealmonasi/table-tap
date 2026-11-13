import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { sessionCookieHeader } from "../session-cookie.mjs";
import { loginSecret } from "../login-secrets.mjs";

// Resolved receipts are immutable while their restaurant exists. Each case
// owns a throwaway restaurant: deleting it cascades its receipt and resolution.
// Never resolve a receipt in the shared demo fixture and leave permanent litter.
async function arrange(fx) {
  const password = loginSecret("TEST_PASSWORD");
  const restaurantId = randomUUID(), posRef = randomUUID(), users = [];
  const previous = fx.who.heldResolve;
  const cleanup = async () => {
    const { error } = await fx.admin.from("restaurants").delete().eq("id", restaurantId);
    if (error) throw new Error(`Could not remove held-resolution restaurant: ${error.message}`);
    for (const id of users) {
      const { error: userError } = await fx.admin.auth.admin.deleteUser(id);
      if (userError) throw new Error(`Could not remove held-resolution login: ${userError.message}`);
    }
    fx.who.heldResolve = previous;
    delete fx.heldResolve;
  };
  try {
    const { error } = await fx.admin.from("restaurants").insert({ id: restaurantId, name: `apicheck held resolve ${restaurantId}`, plan: "caja", plan_status: "active", currency: "MXN" });
    if (error) throw error;
    const cookies = {};
    for (const role of ["manager", "waiter"]) {
      const email = `apicheck-held-${role}-${restaurantId}@tabletap.dev`;
      const { data, error: userError } = await fx.admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (userError) throw userError;
      users.push(data.user.id);
      const { error: staffError } = await fx.admin.from("staff").insert({ restaurant_id: restaurantId, user_id: data.user.id, email, role });
      if (staffError) throw staffError;
      const auth = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
      const { data: login, error: loginError } = await auth.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      cookies[role] = sessionCookieHeader(login.session, process.env.NEXT_PUBLIC_SUPABASE_URL);
    }
    const collectedAt = new Date(Date.now() - 60_000).toISOString(), collector = "apicheck-cashier@tabletap.dev";
    const body = { restaurantId, posRef, method: "cash", items: [], offline: { at: collectedAt, subtotal: 10, total: 10, serviceFee: 0, discount: 0, tip: 0 } };
    const { error: queueError } = await fx.admin.from("offline_sale_queue").insert({ restaurant_id: restaurantId, pos_ref: posRef, body, collector, currency: "MXN", submitted_by: collector, reason: "apiErr.offlineApproval" });
    if (queueError) throw queueError;
    fx.heldResolve = { cookies, body: { restaurantId, posRef, collector, currency: "MXN", collectedAt, disposition: "no_cash", amount: 0, reason: "API fixture: no money was collected" } };
    fx.who.heldResolve = cookies.manager;
    const before = await fetch(`${fx.base}/api/pos/recover`, { headers: { cookie: cookies.manager } });
    if (!before.ok || !(await before.json()).sales.some(s => s.pos_ref === posRef)) throw new Error("Seeded held receipt was not pending");
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}

async function pending(fx) {
  const res = await fetch(`${fx.base}/api/pos/recover`, { headers: { cookie: fx.heldResolve.cookies.manager } });
  if (!res.ok) throw new Error(`Could not read pending receipts: ${res.status}`);
  return (await res.json()).sales.some(s => s.pos_ref === fx.heldResolve.body.posRef);
}
export function heldResolveCases() {
  const common = { as: "heldResolve", method: "POST", path: "/api/pos/recover/resolve", arrange, body: fx => fx.heldResolve.body };
  return [
    { ...common, name: "POST /api/pos/recover/resolve (manager resolves own seeded cash receipt)", expect: [200],
      check: async (data, fx) => {
        if (data.disposition !== "no_cash" || data.amount !== 0 || data.pos_ref !== fx.heldResolve.body.posRef || !data.resolved_by || !data.resolved_at) return "missing resolution audit";
        if (await pending(fx)) return "resolved receipt is still pending";
        const res = await fetch(`${fx.base}/api/pos/recover?view=history`, { headers: { cookie: fx.heldResolve.cookies.manager } });
        if (!res.ok || !(await res.json()).sales.some(s => s.pos_ref === data.pos_ref && s.resolution?.disposition === "no_cash" && !s.approved_at)) return "resolution missing from history";
        return true;
      } },
    { ...common, name: "POST /api/pos/recover/resolve (waiter refused)", expect: [403],
      arrange: async fx => { const undo = await arrange(fx); fx.who.heldResolve = fx.heldResolve.cookies.waiter; return undo; },
      effect: async fx => await pending(fx) || "waiter changed the held receipt" },
    { ...common, name: "POST /api/pos/recover/resolve (same request answers identically)", expect: [200],
      check: async (data, fx) => {
        const res = await fetch(`${fx.base}/api/pos/recover/resolve`, { method: "POST", headers: { "Content-Type": "application/json", cookie: fx.heldResolve.cookies.manager }, body: JSON.stringify(fx.heldResolve.body) });
        return res.status === 200 && JSON.stringify(await res.json()) === JSON.stringify(data) || "repeat request did not return the same resolution";
      } },
  ];
}
