import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingManager: mocks.actor }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("@/lib/disputes/read", () => ({ readDisputeHistory: mocks.read }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
import { GET } from "@/app/api/disputes/history/route";
const id = "11111111-1111-4111-8111-111111111111";
beforeEach(() => { vi.resetAllMocks(); mocks.actor.mockResolvedValue({ restaurantId: "own", role: "manager" }); mocks.admin.mockReturnValue("admin"); mocks.read.mockResolvedValue({}); });
it("requires the existing financial manager boundary before private reads", async () => {
  mocks.actor.mockResolvedValue(null);
  expect((await GET(new NextRequest(`https://test/api/disputes/history?order=${id}`))).status).toBe(403);
  expect(mocks.admin).not.toHaveBeenCalled();
});
it("derives the tenant from the actor, ignoring a supplied restaurant", async () => {
  const response = await GET(new NextRequest(`https://test/api/disputes/history?restaurant=foreign&order=${id}`));
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.read).toHaveBeenCalledWith("admin", "own", [id]);
});
it.each(["not-an-id", Array.from({ length: 21 }, (_, i) => `${i.toString(16).padStart(8, "0")}-1111-4111-8111-111111111111`).join("&order=")])("rejects malformed or excessive order ids", async query => {
  expect((await GET(new NextRequest(`https://test/api/disputes/history?order=${query}`))).status).toBe(400);
  expect(mocks.read).not.toHaveBeenCalled();
});
it("read failure returns an error, never empty financial history", async () => {
  mocks.read.mockRejectedValue(new Error("offline"));
  expect((await GET(new NextRequest(`https://test/api/disputes/history?order=${id}`))).status).toBe(500);
});
