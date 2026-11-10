import { beforeEach, expect, it, vi } from "vitest";
const { rpc, resolve } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve }));
const { checkoutPageRpc } = await import("@/lib/checkout-page-rpc");
const args = { p_restaurant: "r1", p_orders: ["o1"], p_expected: 100, p_ref: "original" };
beforeEach(() => { vi.clearAllMocks(); resolve.mockResolvedValue("closed"); });
it.each([
  { data: "paying", error: null }, { data: { outcome: "paying" }, error: null },
  { data: [{ outcome: "paying" }], error: null }, { data: null, error: { message: "paying", code: "P0001" } },
])("recognizes the writer's refusal without changing its response shape (%#)", async result => {
  rpc.mockResolvedValue(result);
  expect(await checkoutPageRpc("writer", args)).toBe(result);
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[0][1]).toBe(args); expect(rpc.mock.calls[1][1]).toBe(args);
});
it.each(["unresolved", "unverified"])("keeps %s refused without retrying", async outcome => {
  resolve.mockResolvedValue(outcome); const result = { data: "paying", error: null }; rpc.mockResolvedValue(result);
  expect(await checkoutPageRpc("writer", args)).toBe(result); expect(rpc).toHaveBeenCalledTimes(1);
});
it.each(["changed", "part_paid", "split", "duplicate"])("does not mistake %s for a page refusal", async outcome => {
  rpc.mockResolvedValue({ data: { outcome }, error: null });
  await checkoutPageRpc("writer", args); expect(resolve).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
});

it("a lost writer answer never authorizes another collection", async () => {
  const result = { data: null, error: { message: "connection lost" } };
  rpc.mockResolvedValue(result);
  expect(await checkoutPageRpc("writer", args)).toBe(result);
  expect(resolve).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
});
