import { describe, expect, it } from "vitest";
import { readCancel } from "@/lib/cancel-read";
import type { SupabaseClient } from "@supabase/supabase-js";
function database(paid: boolean, hold: string | null, holdId: string | null) {
  return { rpc: async () => ({ data: [], error: null }), from: (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      maybeSingle: async () => ({ data: table === "orders" ? {
        id: "o1", status: "received", paid, account_id: "a1", total: 0, pay_method: "cash",
      } : { checkout_until: hold, checkout_id: holdId }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return q;
  } } as unknown as SupabaseClient;
}
describe("the account hold belongs to the cancellation snapshot", () => {
  it("carries an expired hold and its owner into the cancellation guard", async () => {
    expect(await readCancel(database(false, "2020-01-01T00:00:00Z", "checkout-a"), "r1", "o1"))
      .toMatchObject({ hold: "2020-01-01T00:00:00Z", holdId: "checkout-a" });
  });
  it("refuses a new unpaid plan during an active checkout", async () => {
    expect(await readCancel(database(false, "2099-01-01T00:00:00Z", "checkout-b"), "r1", "o1"))
      .toEqual({ error: "apiErr.accountPayingOnline", status: 409 });
  });
  it("also snapshots the hold for an already-paid account order", async () => {
    expect(await readCancel(database(true, null, null), "r1", "o1"))
      .toMatchObject({ hold: null, holdId: null });
  });
});
