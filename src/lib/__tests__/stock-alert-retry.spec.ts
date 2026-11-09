import { beforeEach, expect, it, vi } from "vitest";

const insert = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ insert }) }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: vi.fn() }));
const { raiseStockNotifications } = await import("@/lib/stock-service");
const warning = { kind: "low_stock" as const, itemId: "dish", name: "Tacos", stock: 2 };
beforeEach(() => { insert.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

it("tries again when the bell write is refused, instead of taking the refusal as done (sweep 5, finding 4)", async () => {
  insert.mockResolvedValueOnce({ error: { message: "timeout" } }).mockResolvedValueOnce({ error: null });
  await raiseStockNotifications("r1", [warning]);
  expect(insert).toHaveBeenCalledTimes(2);
  expect(console.error).not.toHaveBeenCalled();
});

it("never fails the sale, and says so when every try failed", async () => {
  insert.mockRejectedValue(new Error("down"));
  await expect(raiseStockNotifications("r1", [warning])).resolves.toBeUndefined();
  expect(insert).toHaveBeenCalledTimes(3);
  expect(console.error).toHaveBeenCalledOnce();
});
