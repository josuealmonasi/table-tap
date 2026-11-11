import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const update = vi.hoisted(() => vi.fn((_row: Record<string, unknown>) => ({ eq: async () => ({ error: null }) })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update }) }) }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ role: "owner", restaurantId: "r", email: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
const { POST } = await import("@/app/api/settings/route");
beforeEach(() => update.mockClear());

it("an old Settings tab that still sends the service charge saves its other changes and nothing of the charge", async () => {
  const res = await POST(new NextRequest("http://localhost/api/settings", { method: "POST",
    body: JSON.stringify({ name: "Nuevo nombre", service_enabled: true, service_pct: 10 }) }));
  expect(res.status).toBe(200);
  expect(update).toHaveBeenCalledTimes(1);
  expect(update.mock.calls[0][0]).toEqual({ name: "Nuevo nombre" });
});

it("a request carrying only the removed fields changes nothing", async () => {
  const res = await POST(new NextRequest("http://localhost/api/settings", { method: "POST",
    body: JSON.stringify({ service_enabled: false, service_pct: 0 }) }));
  expect(res.status).toBe(200);
  expect(update).not.toHaveBeenCalled();
});
