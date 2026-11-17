import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), owner: vi.fn(), user: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingOwner: mock.owner }));
vi.mock("@/lib/current-user", () => ({ currentUser: mock.user }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mock.rpc, from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) }) }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: mock.invalidate }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
import { POST } from "../route";

beforeEach(() => {
  vi.clearAllMocks();
  mock.owner.mockResolvedValue({ restaurantId: "r1", email: "owner@example.com", role: "owner" });
  mock.user.mockResolvedValue({ id: "u1" });
  mock.rpc.mockResolvedValue({ error: null });
});

it("records each acceptance and its evidence atomically with the current terms", async () => {
  const req = new NextRequest("https://example.com/api/legal/accept", { method: "POST", headers: { "x-forwarded-for": "192.0.2.1", "user-agent": "test-browser" } });
  await POST(req);
  await POST(req);
  expect(mock.rpc).toHaveBeenCalledTimes(2);
  expect(mock.rpc).toHaveBeenCalledWith("accept_terms_v1", expect.objectContaining({
    p_restaurant: "r1", p_user: "u1", p_ip: "192.0.2.1", p_user_agent: "test-browser",
    p_text_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
  }));
});

it("refuses a non-owner without writing evidence", async () => {
  mock.owner.mockResolvedValue(null);
  const response = await POST(new NextRequest("https://example.com/api/legal/accept", { method: "POST" }));
  expect(response.status).toBe(403);
  expect(mock.rpc).not.toHaveBeenCalled();
});

it("reports a database failure instead of claiming acceptance", async () => {
  mock.rpc.mockResolvedValue({ error: { message: "unavailable" } });
  const response = await POST(new NextRequest("https://example.com/api/legal/accept", { method: "POST" }));
  expect(response.status).toBe(500);
});
