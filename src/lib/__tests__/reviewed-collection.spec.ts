import { beforeEach, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
const { recordReviewed } = await import("@/lib/reviewed-collection");

beforeEach(() => rpc.mockReset().mockResolvedValue({ data: { outcome: "written", amount: 135.8, tip: 12.35 }, error: null }));

it("sends the food to the cent: 135.80 with a 12.35 tip is 123.45, not 123.45000000000002", async () => {
  // The collector requires exactly two decimals, so the float was refused as
  // an invalid collection and the MX$135.80 handed over had no receipt.
  expect(135.8 - 12.35).not.toBe(123.45);
  await recordReviewed({ restaurantId: "r", email: "w@example.com" } as never,
    { tableId: "t", expected: 200, currency: "MXN" }, 135.8, 12.35, "cash", "ref");
  expect(rpc.mock.calls[0][1]).toMatchObject({ p_amount: 123.45, p_tip: 12.35 });
});
