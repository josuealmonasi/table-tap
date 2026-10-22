import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

// Use a disposable restaurant, never the demo's real billing or refund state.
// The real admin attempt remains in the append-only audit after cleanup.
export function adminCases() {
  return [
    { name: "GET /api/admin/audit (platform history)", as: "platformAdmin", method: "GET",
      path: "/api/admin/audit", expect: [200],
      check: data => Array.isArray(data.entries) && data.entries.length <= 100 || "no bounded audit page" },
    { name: "DELETE /api/admin/restaurants (pending refund blocks; settled receipts survive deletion)",
      as: "platformAdmin", method: "DELETE", path: "/api/admin/restaurants", expect: [409],
      arrange: async f => {
        const id = randomUUID();
        const cleanup = async () => {
          for (const table of ["restaurants", "restaurant_accounting_records", "restaurant_billing_operations"]) {
            const { error } = await f.admin.from(table).delete().eq(table === "restaurants" ? "id" : "restaurant_id", id);
            if (error) throw new Error(`Admin fixture cleanup failed (${table}): ${error.message}`);
          }
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
          f.adminRefundProbe = { id, order, refund: pending.data.id };
          return cleanup;
        } catch (error) {
          await cleanup();
          throw error;
        }
      },
      body: f => ({ id: f.adminRefundProbe.id }),
      effect: async f => {
        const { id, refund } = f.adminRefundProbe;
        const [restaurant, pending, trail] = await Promise.all([
          f.admin.from("restaurants").select("id").eq("id", id).maybeSingle(),
          f.admin.from("refund_operations").select("status, amount").eq("id", refund).maybeSingle(),
          f.admin.from("platform_admin_audit").select("actor_id, before_facts, after_facts")
            .eq("target_id", id).eq("action", "restaurant.delete").eq("outcome", "refused"),
        ]);
        if (restaurant.error || pending.error || trail.error) return "could not read the refusal's effects";
        if (!(restaurant.data && pending.data?.status === "pending" && pending.data.amount === 25
          && trail.data?.some(row => row.actor_id && row.before_facts.name === "API admin refund probe"
            && row.after_facts.http_status === 409))) return "deletion lost the refund or its audit row";
        const returned = await f.admin.rpc("finish_refund_operation", {
          p_restaurant: id, p_operation: refund, p_actor: "api-admin-probe",
          p_refund: null, p_status: "succeeded", p_payout: "api-admin-probe",
        });
        if (returned.error || returned.data !== true) return "could not finish the refund";
        const sources = ["orders", "payments", "payment_allocations", "order_adjustments", "refund_operations",
          "refund_allocations", "refund_attempts", "refunds_due", "refund_due_attempts"];
        const expected = [];
        for (const table of sources) {
          const rows = await f.admin.from(table).select("*").eq("restaurant_id", id);
          if (rows.error) return `could not read ${table} before deletion`;
          expected.push(...rows.data.map(row => ({ source_table: table, source_id: row.id, row_data: row })));
        }
        for (const table of ["orders", "payments", "payment_allocations", "order_adjustments", "refund_operations", "refund_allocations"]) {
          if (!expected.some(row => row.source_table === table)) return `fixture has no ${table}`;
        }
        const response = await fetch(f.base + "/api/admin/restaurants", {
          method: "DELETE", headers: { "Content-Type": "application/json", cookie: f.who.platformAdmin },
          body: JSON.stringify({ id }),
        });
        if (response.status !== 200) return `settled restaurant could not be deleted (${response.status})`;
        const [gone, retained, succeeded] = await Promise.all([
          f.admin.from("restaurants").select("id").eq("id", id).maybeSingle(),
          f.admin.from("restaurant_accounting_records").select("source_table, source_id, row_data").eq("restaurant_id", id)
            .in("source_table", sources),
          f.admin.from("platform_admin_audit").select("id").eq("target_id", id)
            .eq("action", "restaurant.delete").eq("outcome", "succeeded"),
        ]);
        if (gone.error || retained.error || succeeded.error) return "could not read deletion's effects";
        const byIdentity = (a, b) => `${a.source_table}:${a.source_id}`.localeCompare(`${b.source_table}:${b.source_id}`);
        return (!gone.data && succeeded.data.length > 0
          && isDeepStrictEqual(retained.data.sort(byIdentity), expected.sort(byIdentity)))
          || "deletion lost or changed settled accounting records";
      } },
  ];
}
