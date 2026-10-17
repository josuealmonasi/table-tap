import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/api-guard", () => ({ actingStaff: async () => ({ restaurantId: "r1", role: "waiter" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null,
  planBlocks: async (_id: string, feature: string) => feature === "dineIn" ? NextResponse.json({ error: "plan.needs.dineIn" }, { status: 403 }) : null,
}));
const { POST } = await import("@/app/api/table-order/route");
it("D10 waiter orders require dine-in even if waiter service remains enabled", async () => {
  const response = await POST(new NextRequest("https://test/api", { method: "POST", body: "{}" }));
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: "plan.needs.dineIn" });
});
