import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const upsert = vi.fn(async () => ({ error: null }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ status: "locked", limits: { allows_loyalty: true } }), allPlans: async () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ upsert }) }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
const { POST } = await import("@/app/api/loyalty/program/route");
it("D8 refuses loyalty management when the restaurant is frozen", async () => {
  const response = await POST(new NextRequest("https://test/api", { method: "POST", body: JSON.stringify({ active: false, goal: 5, reward: "Coffee" }) }));
  expect(response.status).toBe(402);
  expect(upsert).not.toHaveBeenCalled();
});
