import { expect, it, vi } from "vitest";
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "own" }) }));
vi.mock("@/lib/membership", () => ({ getMembership: async () => ({
  restaurant: { id: "own", currency: "USD", timezone: "Asia/Tokyo" },
}) }));
vi.mock("@/lib/collected-today", () => ({ collectedToday: async () => 123.45 }));
import { GET } from "@/app/api/orders/takings/route";
it("labels the takings with the verified membership's restaurant and currency", async () => {
  expect(await (await GET()).json()).toEqual({ restaurantId: "own", currency: "USD", collectedToday: 123.45 });
});
