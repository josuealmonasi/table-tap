import { expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async () => ({ data: { outcome: "split" }, error: null }),
}) }));
const { recordReviewed } = await import("@/lib/reviewed-collection");
it("reviewed collection preserves the split refusal for both staff entry points", async () => {
  const result = await recordReviewed({ restaurantId: "r", email: "waiter", role: "waiter" },
    { tableId: "t", expected: 100, currency: "MXN" }, 100, 0, "cash", "ref");
  expect(result).toMatchObject({ split: true, wrote: false, refused: false });
});
