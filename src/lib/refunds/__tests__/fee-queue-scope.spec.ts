import { beforeEach, expect, it, vi } from "vitest";
import { fixture, old } from "@/lib/recovery/__tests__/fixtures";

// Review bg4: the fee queue took any refund on the connected account, and a
// row no record could resolve stayed forever and held the restaurant's deletion.
const { fee, admin } = vi.hoisted(() => ({ fee: vi.fn(), admin: { current: null as unknown } }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("../charge-reconciler", () => ({ reconcileChargeFee: fee }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.current }));
beforeEach(() => { vi.clearAllMocks(); fee.mockResolvedValue(true); });

function withRestaurant() {
  const f = fixture();
  f.tables.restaurants = [{ id: "r1", stripe_account_id: "acct_1" }];
  f.rpc.mockResolvedValue({ data: 2, error: null });
  admin.current = f.context.db;
  return f;
}

it("does not enqueue a refund of a charge TableTap never made", async () => {
  const { enqueueRefundFee } = await import("../fee-queue");
  const f = withRestaurant();
  await enqueueRefundFee({ payment_intent: "pi_outside" } as never, "acct_1");
  expect(f.rpc).not.toHaveBeenCalled();
});

it("bg9: one restaurant per connected account, and an unknown account is answered without an error", async () => {
  const { readFileSync } = await import("node:fs");
  const sql = readFileSync("supabase/schema.sql", "utf8");
  expect(sql).toContain("create unique index if not exists restaurants_stripe_account_unique\n  on restaurants (stripe_account_id) where stripe_account_id is not null;");
  const { enqueueRefundFee } = await import("../fee-queue");
  const f = withRestaurant();
  await expect(enqueueRefundFee({ payment_intent: "pi" } as never, "acct_unknown")).resolves.toBeUndefined();
  expect(f.rpc).not.toHaveBeenCalled();
});

it("enqueues a refund of a charge a TableTap payment or checkout recorded", async () => {
  const { enqueueRefundFee } = await import("../fee-queue");
  for (const table of ["payments", "diner_checkouts"]) {
    const f = withRestaurant();
    f.tables[table] = [{ id: "x", restaurant_id: "r1", stripe_payment_intent: "pi_ours", stripe_account_id: "acct_1" }];
    await enqueueRefundFee({ payment_intent: "pi_ours" } as never, "acct_1");
    expect(f.rpc).toHaveBeenCalledWith("enqueue_fee_reconcile", { p_restaurant: "r1", p_intent: "pi_ours" });
  }
});

it("reads the frozen account from a payment when no checkout row exists", async () => {
  const { recoverQueuedFee } = await import("../fee-queue");
  const f = fixture();
  f.tables.payments = [{ id: "p", restaurant_id: "r1", stripe_payment_intent: "pi", stripe_account_id: "acct_old" }];
  expect(await recoverQueuedFee(f.context.db, f.context.client, "r1", "pi")).toBe(true);
  expect(fee).toHaveBeenCalledWith(f.context.db, f.context.client, "r1", "pi", "acct_old");
});

it("closes a queued charge no record explains as not ours, so it stops blocking deletion", async () => {
  const { recoverFees } = await import("@/lib/recovery/fees");
  const f = fixture();
  f.tables.fee_reconcile_queue = [{ restaurant_id: "r1", stripe_payment_intent: "pi_x", generation: 7, enqueued_at: old }];
  f.tables.payments = [{ id: "p", restaurant_id: "r1", stripe_payment_intent: "pi_x", stripe_account_id: null }];
  f.rpc.mockImplementation(async (name, args) => {
    if (name === "ack_fee_reconcile") f.tables.fee_reconcile_queue = [];
    return { data: true, error: null, args };
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await recoverFees(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(fee).not.toHaveBeenCalled();
  expect(f.rpc).toHaveBeenCalledWith("ack_fee_reconcile", { p_restaurant: "r1", p_intent: "pi_x", p_generation: 7 });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining("not ours"), "r1", "pi_x");
  warn.mockRestore();
});
