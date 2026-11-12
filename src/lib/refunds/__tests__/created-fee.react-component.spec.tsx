import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { chargeFixture } from "./charge-contract-fixtures";

const state = vi.hoisted(() => ({ db: null as unknown, event: null as unknown,
  retrieve: vi.fn(), applySubscription: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.db }));
vi.mock("@/lib/stripe", () => ({ stripe: { charges: { retrieve: state.retrieve } } }));
vi.mock("@/lib/stripe-webhook", () => ({ readStripeEvent: async () => ({ event: state.event }) }));
vi.mock("@/lib/subscription-sync", () => ({ applySubscription: state.applySubscription }));
import { POST } from "@/app/api/webhooks/stripe/route";

const run = () => POST(new NextRequest("https://tabletap.test/api/webhooks/stripe", { method: "POST" }));
beforeEach(() => {
  vi.clearAllMocks();
  state.event = { type: "application_fee.created", data: { object: { id: "fee", account: "acct", charge: "ch" } } };
  state.retrieve.mockResolvedValue({ id: "ch", payment_intent: "pi", amount_refunded: 500 });
});

it("F1 enqueues a newly created fee's intent using its original connected account", async () => {
  const f = chargeFixture("mxn"); state.db = f.db;
  expect((await run()).status).toBe(200);
  expect(state.retrieve).toHaveBeenCalledWith("ch", { stripeAccount: "acct" });
  expect(f.rpc).toHaveBeenCalledWith("enqueue_fee_reconcile", { p_restaurant: "r", p_intent: "pi" });
  await run();
  expect(f.generation).toBe(2);
  expect(f.createRefund).not.toHaveBeenCalled();
});

it("F1 does not acknowledge a failed enqueue or an unavailable charge", async () => {
  const f = chargeFixture("mxn"); state.db = f.db;
  f.rpc.mockResolvedValue({ data: null, error: { message: "enqueue unavailable" } } as never);
  await expect(run()).rejects.toThrow("enqueue unavailable");
  state.retrieve.mockRejectedValueOnce(new Error("charge unavailable"));
  await expect(run()).rejects.toThrow("charge unavailable");
});

it("F1 a fee on a charge nobody refunded enqueues nothing: every sale creates one", async () => {
  const f = chargeFixture("mxn"); state.db = f.db;
  state.retrieve.mockResolvedValue({ id: "ch", payment_intent: "pi", amount_refunded: 0 });
  expect((await run()).status).toBe(200);
  expect(f.rpc).not.toHaveBeenCalledWith("enqueue_fee_reconcile", expect.anything());
});

it("keeps platform subscription handling", async () => {
  state.event = { type: "customer.subscription.updated", data: { object: { id: "sub" } } };
  expect((await run()).status).toBe(200);
  expect(state.applySubscription).toHaveBeenCalledWith({ id: "sub" });
  expect(state.retrieve).not.toHaveBeenCalled();
});
