import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Role } from "@/lib/membership";
const state = vi.hoisted(() => ({
  role: "manager" as Role | null,
  collected: vi.fn(),
}));
vi.mock("@/lib/membership", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/membership")>();
  return { ...original, getMembership: async () => state.role ? {
    role: state.role, restaurant: { id: "own", currency: "USD", timezone: "Asia/Tokyo" },
  } : null };
});
vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ id: "user", email: "manager@example.com" }) }));
vi.mock("@/lib/collected-today", () => ({ collectedToday: state.collected }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
import { GET } from "@/app/api/orders/takings/route";

beforeEach(() => {
  state.role = "manager"; state.collected.mockReset().mockResolvedValue(123.45);
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-27T02:00:00Z"));
});
afterEach(() => vi.useRealTimers());
it.each(["kitchen", "waiter", "cashier", null] as const)("refuses %s before reading any money", async role => {
  state.role = role;
  const response = await GET();
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Forbidden" });
  expect(state.collected).not.toHaveBeenCalled();
});
it.each(["owner", "manager"] as const)("scopes %s to membership, ignoring supplied tenant, currency and date", async role => {
  state.role = role;
  const response = await Reflect.apply(GET, null, [new Request(
    "http://localhost/api/orders/takings?restaurantId=other&currency=MXN&dayStart=2000-01-01",
  )]);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ collectedToday: 123.45 });
  expect(state.collected).toHaveBeenCalledExactlyOnceWith("own", "USD", new Date("2026-10-26T15:00:00Z"));
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
});
it("does not disguise a failed ledger read as zero", async () => {
  state.collected.mockRejectedValue(new Error("ledger unavailable"));
  await expect(GET()).rejects.toThrow("ledger unavailable");
});
