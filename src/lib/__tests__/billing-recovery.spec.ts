import { beforeEach, expect, it, vi } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";

const rpc = vi.fn();
const customers = vi.fn();
const sessions = vi.fn();
const subscriptions = vi.fn();
let snapshot: Record<string, unknown>;
vi.mock("@/lib/stripe", () => ({ stripe: {
  customers: { list: (...a: unknown[]) => customers(...a) },
  checkout: { sessions: { list: (...a: unknown[]) => sessions(...a) } },
  subscriptions: { list: (...a: unknown[]) => subscriptions(...a) },
} }));
vi.mock("@/lib/api-error", () => ({ apiError: vi.fn() }));
const { withRestaurantBilling } = await import("@/lib/billing-operation");
const db = { rpc, from: (table: string) => {
  const q = { select: () => q, eq: () => q,
    maybeSingle: async () => ({ data: table === "restaurants" ? { stripe_customer_id: "cus_1" } : snapshot, error: null }),
  }; return q;
} } as unknown as ReturnType<typeof createAdminClient>;
beforeEach(() => {
  vi.resetAllMocks();
  snapshot = { token: "old-token", started_at: new Date(Date.now() - 16 * 60000).toISOString(), state: {} };
  rpc.mockImplementation(async (fn: string) => ({ data: fn !== "claim_restaurant_billing", error: null }));
  customers.mockResolvedValue({ data: [], has_more: false });
  sessions.mockResolvedValue({ data: [], has_more: false });
  subscriptions.mockResolvedValue({ data: [], has_more: false });
});
it("takes over an expired claim only after Stripe confirms there are no pending contracts", async () => {
  const action = vi.fn().mockResolvedValue("paid");
  expect(await withRestaurantBilling(db, "r1", action)).toBe("paid");
  expect(sessions).toHaveBeenCalled(); expect(subscriptions).toHaveBeenCalled();
  const takeover = rpc.mock.calls.find(c => c[0] === "takeover_restaurant_billing");
  expect(takeover?.[1]).toMatchObject({ p_previous: "old-token", p_state: { customers: ["cus_1"], sessions: [], subscriptions: [] } });
  expect(subscriptions.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0]);
});
it("records previously unknown customers, open sessions and non-final subscriptions before takeover", async () => {
  customers.mockResolvedValue({ data: [{ id: "cus_orphan", metadata: { restaurant_id: "r1" } }], has_more: false });
  sessions.mockResolvedValue({ data: [{ id: "cs_orphan", mode: "subscription" }], has_more: false });
  subscriptions.mockResolvedValue({ data: [{ id: "sub_orphan", status: "incomplete" }], has_more: false });
  await withRestaurantBilling(db, "r1", async () => "resume");
  expect(rpc).toHaveBeenCalledWith("takeover_restaurant_billing", expect.objectContaining({
    p_state: { customers: ["cus_1", "cus_orphan"], sessions: ["cs_orphan"], subscriptions: ["sub_orphan"] },
  }));
});
it("keeps a recent claim and never contacts Stripe", async () => {
  snapshot.started_at = new Date().toISOString();
  await expect(withRestaurantBilling(db, "r1", vi.fn())).rejects.toThrow("apiErr.billingBusy");
  expect(customers).not.toHaveBeenCalled();
});
it("does not take over when Stripe cannot confirm the old request", async () => {
  sessions.mockRejectedValue(new Error("Stripe unavailable"));
  await expect(withRestaurantBilling(db, "r1", vi.fn())).rejects.toThrow("Stripe unavailable");
  expect(rpc.mock.calls.some(c => c[0] === "takeover_restaurant_billing")).toBe(false);
});
it("does not act if another recovering request wins the claim", async () => {
  rpc.mockResolvedValue({ data: false, error: null });
  const action = vi.fn();
  await expect(withRestaurantBilling(db, "r1", action)).rejects.toThrow("apiErr.billingBusy");
  expect(action).not.toHaveBeenCalled();
});
it("fences a resumed old worker before it can write to Stripe", async () => {
  rpc.mockImplementation(async (fn: string) => ({ data: fn !== "record_restaurant_billing", error: null }));
  const write = vi.fn();
  await expect(withRestaurantBilling(db, "r1", async op => op.write(write))).rejects.toThrow("apiErr.billingBusy");
  expect(write).not.toHaveBeenCalled();
});

it("returns a successful payment link even if releasing the claim fails", async () => {
  rpc.mockImplementation(async (fn: string) => ({ data: true,
    error: fn === "release_restaurant_billing" ? { message: "database unavailable" } : null }));
  expect(await withRestaurantBilling(db, "r1", async () => "https://checkout/pay")).toBe("https://checkout/pay");
});
