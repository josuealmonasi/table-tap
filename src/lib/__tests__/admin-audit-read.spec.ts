import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET } from "@/app/api/admin/audit/route";

let allowed = true;
let error: object | null = null;
let rows: Record<string, unknown>[] = [];
const or = vi.fn();
const read = vi.fn();
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => allowed ? { userId: "admin" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  read(table);
  const query = {
    select: () => query, order: () => query, limit: () => query,
    or: (filter: string) => { or(filter); return query; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve),
  };
  return query;
} }) }));
const request = (cursor?: string) => new NextRequest(`https://test.dev/api/admin/audit${cursor === undefined ? "" : `?before=${encodeURIComponent(cursor)}`}`);
beforeEach(() => { allowed = true; error = null; rows = []; vi.clearAllMocks(); });
it("refuses audit reads without platform admin membership before querying", async () => {
  allowed = false;
  expect((await GET(request())).status).toBe(403);
  expect(read).not.toHaveBeenCalled();
});
it("pages through equal timestamps without caching private history", async () => {
  const time = "2026-10-21T12:00:00.123456+00:00", id = "22222222-2222-4222-8222-222222222222";
  rows = Array.from({ length: 101 }, () => ({ id, created_at: time, action: "login.update" }));
  const response = await GET(request());
  const data = await response.json();
  expect(data.entries).toHaveLength(100);
  expect(data.nextCursor).toBe(`${time},${id}`);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  rows = [];
  const next = await GET(request(data.nextCursor));
  expect(await next.json()).toEqual({ entries: [], nextCursor: null });
  expect(or).toHaveBeenCalledWith(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`);
});
it.each(["", "garbage", "2026-10-21T12:00:00Z,anything", "2026-10-21T12:00:00Z,22222222-2222-4222-8222-222222222222,or(id.gt.0)"])("rejects invalid or injected cursor %s", async cursor => {
  expect((await GET(request(cursor))).status).toBe(400);
  expect(read).not.toHaveBeenCalled();
});
it("reports a database read failure without returning history", async () => {
  error = { message: "private database detail" };
  const response = await GET(request());
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("private database detail");
});
