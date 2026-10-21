import { createHash, createHmac, randomUUID } from "node:crypto";

/** Real phone cookies and an isolated table. No shared menu, setting or bill is changed. */
export async function tableJoinScenario({ admin, base, restaurantId, dish }) {
  const address = `join-${randomUUID()}`;
  const { data: table, error } = await admin.from("restaurant_tables")
    .insert({ restaurant_id: restaurantId, label: address }).select("id, label").single();
  if (error) throw new Error(error.message);
  const cards = [];
  const send = async (path, method = "GET", body, cookie = "") => {
    const res = await fetch(base + path, { method, headers: {
      "Content-Type": "application/json", cookie, "x-forwarded-for": address,
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    if (path === "/api/loyalty/card" && data.code) cards.push(data.code);
    return { status: res.status, body: data, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? cookie };
  };
  const cleanup = async () => {
    const { data: orders } = await admin.from("orders").select("id, stock_reservation_id").eq("table_id", table.id);
    for (const order of orders ?? []) if (order.stock_reservation_id) {
      const { error: releaseError } = await admin.rpc("release_stock_reservation", { p_restaurant: restaurantId, p_reservation: order.stock_reservation_id });
      if (releaseError) throw new Error(releaseError.message);
    }
    const ids = (orders ?? []).map(o => o.id);
    if (ids.length) {
      await admin.from("payments").delete().in("order_id", ids);
    }
    if (cards.length) await admin.from("loyalty_cards").delete().eq("restaurant_id", restaurantId).in("code", cards);
    const reservations = (orders ?? []).map(o => o.stock_reservation_id).filter(Boolean);
    await admin.from("service_requests").delete().eq("table_id", table.id);
    await admin.from("orders").delete().eq("table_id", table.id);
    if (reservations.length) await admin.from("stock_reservations").delete().in("id", reservations);
    await admin.from("table_sessions").delete().eq("table_id", table.id);
    await admin.from("restaurant_tables").delete().eq("id", table.id);
    const hash = value => createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update(value).digest("hex").slice(0, 20);
    const roomKey = hash(address);
    const tableKey = hash(`${roomKey}|${table.id}`);
    await admin.from("rate_limits").delete().like("bucket", `%:${roomKey}`);
    await admin.from("rate_limits").delete().like("bucket", `%:${tableKey}`);
  };
  const body = { restaurantId, tableId: table.id };
  const open = async cookie => {
    const hash = createHash("sha256").update(cookie.split("=")[1]).digest("hex");
    const result = await admin.rpc("request_table_member", { p_restaurant: restaurantId, p_table: table.id, p_hash: hash, p_open: true });
    if (result.error) throw new Error(result.error.message);
    return result.data;
  };
  const order = async (session, diner) => {
    const { data, error: orderError } = await admin.from("orders").insert({
      restaurant_id: restaurantId, table_id: table.id, table_label: table.label,
      session_id: session, diner, subtotal: 10, total: 10, currency: "MXN", paid: false,
      status: "received", items: [], note: address,
    }).select("id").single();
    if (orderError) throw new Error(orderError.message);
    return data.id;
  };
  try {
    const first = await send("/api/table-membership", "POST", body);
    if (first.status !== 200 || first.body.status !== "empty" || !first.cookie) throw new Error("Empty-table bootstrap failed");
    const approved = await open(first.cookie);
    if (approved.status !== "approved") throw new Error("First checkout did not approve its phone");
    const orderId = await order(approved.sessionId, approved.diner);
    const second = await send("/api/table-membership", "POST", body);
    const third = await send("/api/table-membership", "POST", body);
    return { admin, send, cleanup, open, order, first, second, third, approved, orderId, table, body, dish };
  } catch (e) { await cleanup(); throw e; }
}
