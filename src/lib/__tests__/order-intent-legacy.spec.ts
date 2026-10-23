import { beforeEach, expect, it, vi } from "vitest";

// Rows saved before references were bound to their request carry the old
// scope. The clients in production forget a reference on a 409, so their
// unchanged retry must get the saved order, not a conflict and a second
// MX$100 order (cross-review of batch 5, finding 3).
const rows = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: { p_ref: string; p_scope: string }) => {
    if (name === "create_order_intent" && rows.get(args.p_ref) !== args.p_scope) return { data: { conflict: true }, error: null };
    const scope = rows.get(args.p_ref);
    if (scope === undefined) return { data: null, error: null };
    if (scope !== args.p_scope) return { data: { conflict: true }, error: null };
    return { data: { orderId: `order-${args.p_ref}`, total: 100, repeat: true }, error: null };
  },
}) }));
const { readOrderIntent, writeOrderIntent } = await import("@/lib/order-intent");
beforeEach(() => rows.clear());

it("a row saved under the old scope answers its unchanged retry", async () => {
  rows.set("old", "checkout:t1:member");
  expect(await readOrderIntent({ restaurantId: "r", ref: "old", scope: "checkout:t1:member:abc", legacyScope: "checkout:t1:member" }))
    .toMatchObject({ orderId: "order-old", repeat: true });
});

it("a row saved under the new scope still refuses a different request", async () => {
  rows.set("new", "checkout:t1:member:abc");
  expect(await readOrderIntent({ restaurantId: "r", ref: "new", scope: "checkout:t1:member:xyz", legacyScope: "checkout:t1:member" }))
    .toEqual({ conflict: true });
});

it("another phone's or table's old row is still a conflict", async () => {
  rows.set("old", "checkout:t2:other");
  expect(await readOrderIntent({ restaurantId: "r", ref: "old", scope: "checkout:t1:member:abc", legacyScope: "checkout:t1:member" }))
    .toEqual({ conflict: true });
});

it("a row an older server saved during the write is still the same order", async () => {
  rows.set("race", "table-order:t1");
  const result = await writeOrderIntent({ restaurantId: "r", ref: "race", scope: "table-order:t1:abc", legacyScope: "table-order:t1" },
    { order: {}, lines: [], inventory: false, threshold: 0 });
  expect(result).toMatchObject({ orderId: "order-race", repeat: true });
});
