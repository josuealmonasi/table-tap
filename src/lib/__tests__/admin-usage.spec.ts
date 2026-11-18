import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const read = vi.fn();
let allowed = true;
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => allowed ? { userId: "admin" } : null }));
vi.mock("@/lib/admin-usage-read", () => ({ readAdminUsage: read }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
const { GET } = await import("@/app/api/admin/restaurants/usage/route");
const id = "11111111-1111-4111-8111-111111111111";
const request = (query: string) => new NextRequest(`https://test.dev/api/admin/restaurants/usage${query}`);
beforeEach(() => { allowed = true; read.mockReset(); });

it("refuses non-admins before reading the restaurant", async () => {
  allowed = false;
  expect((await GET(request(`?id=${id}`))).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
});
it("rejects invalid ids, missing restaurants and failed reads", async () => {
  expect((await GET(request("?id=bad"))).status).toBe(400);
  read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("unavailable"));
  expect((await GET(request(`?id=${id}`))).status).toBe(404);
  expect((await GET(request(`?id=${id}`))).status).toBe(500);
});
it("reads only the requested restaurant", async () => {
  const figures = { staff: 2, lastActivity: null };
  read.mockResolvedValue(figures);
  const response = await GET(request(`?id=${id}`));
  expect(await response.json()).toEqual(figures);
  expect(read).toHaveBeenCalledWith(id);
});
