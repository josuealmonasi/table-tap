import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
const checked = async query => {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
};

/** Private bills and a private card. Cleanup also runs after partial setup. */
export async function loyaltyAttachmentFixture(f) {
  const admin = f.admin, r = f.restaurant.id;
  const tableId = randomUUID(), sessionId = randomUUID(), cardId = randomUUID();
  const ids = [randomUUID(), randomUUID()];
  const label = `loyalty-${tableId.slice(0, 8)}`;
  const address = `loyalty-${randomUUID()}`;
  const token = randomBytes(32).toString("base64url");
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const code = Array.from(randomBytes(12), n => alphabet[n & 31]).join("");
  const cookie = `tt-table-member=${token}`;
  const cleanup = async () => {
    await checked(admin.from("user_logs").delete().eq("restaurant_id", r).eq("entity", "bill").like("detail", `%table=${label}%`));
    const hash = value => createHmac("sha256", process.env.SUPABASE_SECRET_KEY ?? "").update(value).digest("hex").slice(0, 20);
    const room = hash(address);
    for (const key of [room, hash(`${room}|${tableId}`), hash(`${room}|counter`)]) {
      await checked(admin.from("rate_limits").delete().like("bucket", `%:${key}`));
    }
    await checked(admin.from("payments").delete().eq("restaurant_id", r).eq("session_id", sessionId));
    await checked(admin.from("payments").delete().eq("restaurant_id", r).in("order_id", ids));
    await checked(admin.from("orders").delete().eq("restaurant_id", r).in("id", ids));
    await checked(admin.from("table_sessions").delete().eq("restaurant_id", r).eq("id", sessionId));
    await checked(admin.from("restaurant_tables").delete().eq("restaurant_id", r).eq("id", tableId));
    await checked(admin.from("loyalty_cards").delete().eq("restaurant_id", r).eq("id", cardId));
  };
  const send = async (path, body, as = "waiter") => {
    const res = await fetch(f.base + path, { method: "POST", headers: {
      "Content-Type": "application/json", "x-forwarded-for": address, cookie: as === "diner" ? cookie : f.who[as],
    }, body: JSON.stringify(body) });
    return { status: res.status, data: await res.json() };
  };
  try {
    await checked(admin.from("loyalty_cards").insert({ id: cardId, restaurant_id: r, code, goal: 8,
      steps: [{ visits: 8, reward: "Fixture reward" }] }));
    await checked(admin.from("restaurant_tables").insert({ id: tableId, restaurant_id: r, label }));
    await checked(admin.from("table_sessions").insert({ id: sessionId, restaurant_id: r, table_id: tableId }));
    await checked(admin.from("table_session_members").insert({ session_id: sessionId,
      token_hash: createHash("sha256").update(token).digest("hex"), status: "approved" }));
    await checked(admin.from("orders").insert(ids.map(id => ({ id, restaurant_id: r,
      table_label: label, status: "received", paid: false, items: [], subtotal: 10, total: 10, currency: "MXN", note: "loyalty-attachment-fixture" }))));
    return { ids, cardId, code, tableId, sessionId, cookie, address, cleanup, send,
      body: { restaurantId: r, tableId, sessionId, code },
      visits: () => checked(admin.from("loyalty_visits").select("actor_email, visit_day").eq("card_id", cardId)),
      attach: orderId => send("/api/loyalty/attach", { orderId, code }),
      pay: orderId => send("/api/table-payment", { orderId, settlement: "cash", expected: 10, currency: "MXN" }),
    };
  } catch (error) { await cleanup(); throw error; }
}
