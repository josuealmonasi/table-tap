import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const read = vi.fn();
let allowed = true;
// The audit stream, over a fake database: every row the route appends.
const audit: Record<string, unknown>[] = [];
let auditDown = false;
vi.mock("server-only", () => ({}));
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => allowed ? { userId: "admin", email: "admin@test.dev" } : null }));
vi.mock("@/lib/admin-usage-read", () => ({ readAdminUsage: read }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({ insert: async (row: Record<string, unknown>) => {
    if (auditDown) return { error: { message: "unavailable" } };
    audit.push(row);
    return { error: null };
  } }),
}) }));
const { GET } = await import("@/app/api/admin/restaurants/usage/route");
const id = "11111111-1111-4111-8111-111111111111";
const request = (query: string) => new NextRequest(`https://test.dev/api/admin/restaurants/usage${query}`);
beforeEach(() => { allowed = true; auditDown = false; audit.length = 0; read.mockReset(); });

it("refuses non-admins before reading the restaurant", async () => {
  allowed = false;
  expect((await GET(request(`?id=${id}`))).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
  expect(audit).toEqual([]);
});
it("rejects invalid ids, missing restaurants and failed reads", async () => {
  expect((await GET(request("?id=bad"))).status).toBe(400);
  read.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("unavailable"));
  expect((await GET(request(`?id=${id}`))).status).toBe(404);
  expect((await GET(request(`?id=${id}`))).status).toBe(500);
  expect(audit.map(row => row.outcome)).toEqual(["started", "refused", "started", "uncertain"]);
});
it("reads only the requested restaurant", async () => {
  const figures = { staff: 2, lastActivity: null };
  read.mockResolvedValue(figures);
  const response = await GET(request(`?id=${id}`));
  expect(await response.json()).toEqual(figures);
  expect(read).toHaveBeenCalledWith(id);
});

// Admin recheck: the sales figures were read with no platform_admin_audit row.
it("audits a restaurant.view (usage) before the read, naming the restaurant and never the figures", async () => {
  read.mockImplementation(async () => {
    expect(audit.map(row => row.outcome)).toEqual(["started"]);
    return { staff: 2, lastActivity: null, last30: { revenue: 987654 } };
  });
  expect((await GET(request(`?id=${id}`))).status).toBe(200);
  expect(audit.map(row => row.outcome)).toEqual(["started", "succeeded"]);
  expect(audit[0]).toMatchObject({ action: "restaurant.view", target_type: "restaurant", target_id: id,
    actor_email: "admin@test.dev", after_facts: { read_only: true, view: "usage" } });
  expect(audit[0].attempt_id).toBe(audit[1].attempt_id);
  expect(JSON.stringify(audit)).not.toContain("987654");
});
it("reads no figures while the audit stream is down", async () => {
  auditDown = true;
  read.mockResolvedValue({ staff: 2 });
  const response = await GET(request(`?id=${id}`));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "apiErr.adminAuditUnavailable" });
  expect(read).not.toHaveBeenCalled();
});
