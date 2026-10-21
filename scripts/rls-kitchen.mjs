// Kitchen access is measured against its own real rows, with a readable ticket
// as the control. An empty table or a dead session must never pass for privacy.
export async function checkKitchenMoney({ admin, kitchen, home, ok, bad, base }) {
  const remove = [];
  const plant = async (table, row) => {
    const { data, error } = await admin.from(table).insert({ restaurant_id: home.id, ...row }).select("*").single();
    if (error) throw new Error(`${table}: ${error.message}`);
    remove.unshift(() => admin.from(table).delete().eq("id", data.id));
    return data;
  };
  try {
    const { data: table } = await admin.from("restaurant_tables").select("id").eq("restaurant_id", home.id).limit(1).single();
    if (!table) throw new Error("no home table for the sitting/split controls");
    const order = await plant("orders", {
      status: "received", subtotal: 12, total: 12, tip: 0, paid: false,
      note: "rls kitchen money probe",
      items: [{ name: "Kitchen probe", emoji: "x", qty: 1, price: 10, discountPct: 5, comboRegular: 20,
        station: "bar", mods: { Milk: "Oat" }, notes: "No ice",
        extras: [{ name: "Milk", price: 2 }],
        components: [{ name: "Coffee", qty: 1, price: 10, extras: [{ name: "Milk", price: 2 }] }] }],
    });
    await plant("payments", { order_id: order.id, amount: 12, method: "cash", actor_email: "rls-kitchen@tabletap.dev" });
    const sitting = await plant("table_sessions", { table_id: table.id, closed_at: new Date().toISOString(), close_reason: "expired" });
    const split = await plant("bill_splits", { session_id: sitting.id, shares: 2, amount: 12, status: "done", proposed_by: "rls-kitchen" });
    const claim = await admin.from("bill_split_claims").insert({ split_id: split.id, share_no: 0, diner: "rls-kitchen", amount: 6 });
    if (claim.error) throw new Error(claim.error.message);
    const call = await plant("service_requests", { table_id: table.id, table_label: "Kitchen probe", kind: "bill" });
    await plant("notifications", { kind: "refund_due", data: { amount: 12, currency: "MXN" } });
    await plant("refunds_due", { stripe_payment_intent: `rls-kitchen-${order.id}`, amount: 12, order_ids: [order.id] });
    await plant("coupon_redemptions", { order_id: order.id, code: "RLS-KITCHEN", amount: 1 });
    await plant("coupons", { code: `RLS-${order.id}`, kind: "fixed", value: 1 });
    await plant("discount_requests", { order_ids: [order.id], code: "RLS-KITCHEN", amount: 1, requested_by: "rls-kitchen" });
    await plant("write_off_requests", { order_ids: [order.id], amount: 12, reason: "walkout", requested_by: "rls-kitchen" });

    const request = await kitchen.from("kitchen_requests").select("*").eq("id", call.id).single();
    if (request.error || request.data?.table_label !== call.table_label) bad("kitchen cannot read its own waiter calls");
    else if ("table_id" in request.data || JSON.stringify(request.data).includes(table.id)) bad("a kitchen call reveals the table's bill credential");
    else ok("kitchen reads waiter calls without the table's bill credential");

    const pending = await plant("orders", { status: "pending_payment", items: order.items, note: order.note });
    const hidden = await kitchen.from("kitchen_tickets").select("id").eq("id", pending.kitchen_ticket_id);
    if (hidden.error || hidden.data?.length) bad("a pending checkout reached the pass, or could not be checked");
    else ok("pending checkouts stay off the pass");

    const control = await kitchen.from("kitchen_tickets").select("*").eq("id", order.kitchen_ticket_id).single();
    if (control.error || control.data?.items?.[0]?.notes !== "No ice") {
      bad(`kitchen cannot read its own preparation ticket: ${control.error?.message ?? "missing lines"}`);
    } else {
      const moneyKeys = /"(?:price|total|subtotal|tip|paid|pay_method|discount|discountPct|comboRegular|order_id|session_id|table_id|kitchen_ticket_id)"/;
      const text = JSON.stringify(control.data);
      if (moneyKeys.test(text) || [order.id, sitting.id, table.id].some(id => text.includes(id))) bad("a kitchen ticket contains money or a diner lookup credential");
      else ok("kitchen reads dishes, modifiers and nested extras without money or diner lookup credentials");
      await kitchen.from("kitchen_tickets").update({ note: "forged" }).eq("id", order.kitchen_ticket_id);
      const saved = await admin.from("kitchen_tickets").select("note").eq("id", order.kitchen_ticket_id).single();
      if (saved.data?.note === order.note) ok("kitchen cannot forge the ticket projection");
      else bad("kitchen changed its server-maintained ticket");
    }

    for (const status of ["preparing", "ready", "completed"]) {
      const changed = await admin.from("orders").update({ status, stations_ready: ["bar"] }).eq("id", order.id);
      if (changed.error) throw new Error(changed.error.message);
      const synced = await kitchen.from("kitchen_tickets").select("status,stations_ready").eq("id", order.kitchen_ticket_id).single();
      if (synced.error || synced.data?.status !== status || synced.data.stations_ready?.[0] !== "bar") bad(`kitchen lost the ${status} update`);
      else ok(`kitchen reads the ${status} update and station readiness`);
    }

    // These tables have row policies. Real home rows above make a kitchen-wide
    // works_at leak observable, including the split claim through its parent.
    for (const name of ["orders", "payments", "table_sessions", "bill_splits", "service_requests", "restaurant_tables", "notifications", "refunds_due",
      "coupon_redemptions", "coupons", "discount_requests", "write_off_requests"]) {
      const seen = await kitchen.from(name).select("*").eq("restaurant_id", home.id).limit(1);
      if (seen.data?.length) bad(`kitchen reads money from ${name}`);
      else if (seen.error && seen.error.code !== "42501") bad(`${name} was not checked: ${seen.error.message}`);
      else ok(`kitchen sees no ${name} rows`);
    }
    const claims = await kitchen.from("bill_split_claims").select("*").eq("split_id", split.id);
    if (claims.data?.length) bad("kitchen reads split claim amounts");
    else if (claims.error && claims.error.code !== "42501") bad(`split claims were not checked: ${claims.error.message}`);
    else ok("kitchen sees no split claim amounts");

    // Server-only grants refuse the query itself, even when a table is empty.
    // A missing table/column or a different failure is not evidence of denial.
    for (const name of ["payment_allocations", "order_adjustments", "refund_operations", "refund_allocations", "refund_attempts", "refund_due_attempts",
      "cash_shifts", "cash_movements", "terminal_deposits", "platform_fees", "offline_sale_queue",
      "customer_accounts", "account_checkouts", "ingredients", "ingredient_prices", "recipe_lines",
      "waste_entries", "ingredient_purchases", "ingredient_counts", "restaurant_billing_operations", "restaurant_subscription_prices", "print_jobs",
      "loyalty_programs", "loyalty_cards", "loyalty_visits", "loyalty_redemptions"]) {
      const seen = await kitchen.from(name).select("*").limit(1);
      if (seen.error?.code === "42501") ok(`kitchen is denied ${name}`);
      else bad(`kitchen's ${name} query was not denied by grants (${seen.error?.message ?? `${seen.data?.length ?? 0} rows`})`);
    }
    for (const [fn, args] of [["kitchen_items", { p_items: order.items }]]) {
      const result = await kitchen.rpc(fn, args);
      if (result.error?.code === "42501") ok(`kitchen cannot call ${fn} directly`);
      else bad(`kitchen's ${fn} query was not denied by grants`);
    }
    const tracker = await fetch(`${base}/api/order-status?id=${order.kitchen_ticket_id}`);
    if (tracker.status === 404) ok("a ticket id cannot open the public diner tracker");
    else bad(`the diner tracker accepted a kitchen ticket id (${tracker.status})`);
  } catch (error) {
    bad(`kitchen privacy checks could not complete: ${error.message}`);
  } finally {
    for (const cleanup of remove) {
      const { error } = await cleanup();
      if (error) bad(`kitchen probe cleanup failed: ${error.message}`);
    }
  }
}
