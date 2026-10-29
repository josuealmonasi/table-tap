import { beforeEach, describe, expect, it, vi } from "vitest";
const { resolve, unresolved } = vi.hoisted(() => ({ resolve: vi.fn(), unresolved: vi.fn() }));
vi.mock("@/lib/account-checkout-state", () => ({ unresolvedAccounts: unresolved }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
beforeEach(() => { resolve.mockReset().mockResolvedValue("unresolved"); unresolved.mockReset().mockResolvedValue(new Set(["a1"])); });
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
  it("an old timestamp cannot clear an unresolved account page", async () => {
    expect(await readCancel(database(false, "2020-01-01T00:00:00Z", "checkout-a"), "r1", "o1"))
      .toEqual({ error: "apiErr.accountPayingOnline", status: 409 });
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

it("a Stripe-confirmed expiry lets cancellation reach its locked writer", async () => {
  resolve.mockResolvedValue("closed");
  unresolved.mockResolvedValueOnce(new Set(["a1"])).mockResolvedValue(new Set());
  expect(await readCancel(database(false, "2099-01-01T00:00:00Z", "checkout-a"), "r1", "o1"))
    .toMatchObject({ order: { id: "o1" } });
});

it("an unresolved row still blocks when both legacy hold fields are missing", async () => {
  expect(await readCancel(database(false, null, null), "r1", "o1")).toEqual({ error: "apiErr.accountPayingOnline", status: 409 });
});
