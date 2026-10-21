import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const update = vi.hoisted(() => vi.fn(() => ({ eq: async () => ({ error: null }) })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update }) }) }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ role: "owner", restaurantId: "r", email: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
const { POST } = await import("@/app/api/settings/route");
beforeEach(() => update.mockClear());
it.each(["JPY", "BHD", "EUR", "mxn", "", null, 123])("settings refuses unsupported currency %s before writing", async currency => {
  const response = await POST(new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify({ currency }) }));
  expect(response.status).toBe(400);
  expect(update).not.toHaveBeenCalled();
});
it.each(["MXN", "USD"])("settings keeps %s available", async currency => {
  expect((await POST(new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify({ currency }) }))).status).toBe(200);
});
