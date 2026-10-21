import { randomUUID } from "node:crypto";

// Use a disposable restaurant, never the demo's real billing or refund state.
// The real admin attempt remains in the append-only audit after cleanup.
export function adminCases() {
  return [
    { name: "GET /api/admin/audit (platform history)", as: "platformAdmin", method: "GET",
      path: "/api/admin/audit", expect: [200],
      check: data => Array.isArray(data.entries) && data.entries.length <= 100 || "no bounded audit page" },
    { name: "DELETE /api/admin/restaurants (pending refund stays and refusal is audited)",
      as: "platformAdmin", method: "DELETE", path: "/api/admin/restaurants", expect: [409],
      arrange: async f => {
        const id = randomUUID();
        const cleanup = async () => {
          const { error } = await f.admin.from("restaurants").delete().eq("id", id);
          if (error) throw new Error(`Admin fixture cleanup failed: ${error.message}`);
        };
        const insert = async (table, row) => {
          const { error } = await f.admin.from(table).insert(row);
          if (error) throw new Error(`${table}: ${error.message}`);
        };
        try {
          await insert("restaurants", { id, name: "API admin refund probe", plan: "carta", plan_status: "active" });
          const order = randomUUID();
          await insert("orders", { id: order, restaurant_id: id, status: "pending_payment", subtotal: 25, total: 25, currency: "MXN" });
          const settled = await f.admin.rpc("settle_sale_v2", { p_restaurant: id, p_order: order,
            p_method: "cash", p_actor: "api-admin-probe", p_status: "received" });
          if (settled.error) throw new Error(`Refund fixture collection failed: ${settled.error.message}`);
          const prepared = await f.admin.rpc("prepare_order_refund", { p_restaurant: id, p_order: order,
            p_actor: "api-admin-probe", p_legacy_demand: [], p_expected_paid: true,
            p_expected_account: null, p_expected_hold: null, p_expected_checkout: null });
          if (prepared.error || prepared.data?.outcome !== "cancelled") throw new Error("Refund fixture cancellation failed");
          const pending = await f.admin.from("refund_operations").select("id")
            .eq("restaurant_id", id).eq("adjustment_id", prepared.data.adjustment).eq("status", "pending").single();
          if (pending.error || !pending.data) throw new Error("Refund fixture has no pending return");
          f.adminRefundProbe = { id, refund: pending.data.id };
          return cleanup;
        } catch (error) {
          await cleanup();
          throw error;
        }
      },
      body: f => ({ id: f.adminRefundProbe.id }),
      check: async (_data, f) => {
        const { id, refund } = f.adminRefundProbe;
        const [restaurant, pending, trail] = await Promise.all([
          f.admin.from("restaurants").select("id").eq("id", id).maybeSingle(),
          f.admin.from("refund_operations").select("status, amount").eq("id", refund).maybeSingle(),
          f.admin.from("platform_admin_audit").select("actor_id, before_facts, after_facts")
            .eq("target_id", id).eq("action", "restaurant.delete").eq("outcome", "refused"),
        ]);
        if (restaurant.error || pending.error || trail.error) return "could not read the refusal's effects";
        return Boolean(restaurant.data && pending.data?.status === "pending" && pending.data.amount === 25
          && trail.data?.some(row => row.actor_id && row.before_facts.name === "API admin refund probe"
            && row.after_facts.http_status === 409)) || "deletion lost the refund or its audit row";
      } },
  ];
}
