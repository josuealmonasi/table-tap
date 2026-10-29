import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import { returnFixture } from "./returns-contract-fixtures";

const { rpc, from, syncFee } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), syncFee: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
vi.mock("@/lib/refunds/fee", () => ({ syncReturnedFee: syncFee }));
import { executeOrderRefund } from "@/lib/refunds/operations";

let fixture: ReturnType<typeof returnFixture>;
function provider() {
  return { refunds: { list: vi.fn(() => (async function* () {})()), create: vi.fn(), retrieve: vi.fn() } };
}
beforeEach(() => {
  vi.clearAllMocks();
  syncFee.mockResolvedValue(undefined);
  fixture = returnFixture();
  fixture.tables.refund_operations = [{ id: "operation", restaurant_id: "tenant", source: "stripe", status: "pending",
    currency: "MXN", stripe_account_id: "acct_original", stripe_payment_intent: "pi_original" }];
  from.mockImplementation(fixture.from);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

it.each([
  { operation_status: "succeeded" },
  { operation_status: "succeeded", outstanding_cents: 0, id: null, stripe_account_id: null, stripe_payment_intent: null, currency: null },
  { operation_status: "processing", outstanding_cents: 0 },
])("recognizes concurrent manual-only completion without an app attempt: %j", async answer => {
  rpc.mockImplementation(async () => {
    // A manager completes the return after discovery, before start takes its lock.
    fixture.tables.refund_operations[0].status = "succeeded";
    return { data: answer, error: null };
  });
  const client = provider();
  expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
  expect(rpc).toHaveBeenCalledExactlyOnceWith("start_refund_attempt", { p_restaurant: "tenant", p_operation: "operation" });
  expect(syncFee).toHaveBeenCalledExactlyOnceWith(client, "tenant", "pi_original", "acct_original");
  expect(client.refunds.create).not.toHaveBeenCalled();
  expect(client.refunds.retrieve).not.toHaveBeenCalled();
});

it("recovers fees for an already succeeded manual-only operation without discovery or an attempt", async () => {
  fixture.tables.refund_operations[0].status = "succeeded";
  const client = provider();
  expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
  expect(rpc).not.toHaveBeenCalled();
  expect(client.refunds.list).not.toHaveBeenCalled();
  expect(client.refunds.create).not.toHaveBeenCalled();
  expect(syncFee).toHaveBeenCalledExactlyOnceWith(client, "tenant", "pi_original", "acct_original");
});

it("keeps manual-only customer completion when fee recovery fails", async () => {
  rpc.mockResolvedValue({ data: { operation_status: "succeeded", outstanding_cents: 0 }, error: null });
  syncFee.mockRejectedValue(new Error("provider unavailable"));
  const client = provider();
  expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(true);
  expect(syncFee).toHaveBeenCalledOnce();
  expect(client.refunds.create).not.toHaveBeenCalled();
});

it.each([null, {}, { operation_status: "processing", outstanding_cents: 6000 }, { outstanding_cents: "0" }])(
  "does not complete an unproven return without an app attempt: %j", async answer => {
    rpc.mockResolvedValue({ data: answer, error: null });
    const client = provider();
    expect(await executeOrderRefund("tenant", "operation", "manager", client as unknown as Stripe)).toBe(false);
    expect(syncFee).not.toHaveBeenCalled();
    expect(client.refunds.create).not.toHaveBeenCalled();
  },
);
