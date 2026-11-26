import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The duplicate check and its expiry moved into `raise_service_request_v1`
 * (Codex review bl40, finding 4). The route must pass the call through and
 * report the SQL's answer; the SQL must expire with the board's cutoff.
 */
const state = vi.hoisted(() => ({ answer: "created", calls: [] as unknown[] }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "m", sessionId: "s" }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "t", qr_key: null }, error: null }) };
    return q;
  },
  rpc: async (fn: string, args: unknown) => { state.calls.push([fn, args]); return { data: { status: state.answer }, error: null }; },
}) }));
import { POST } from "@/app/api/service-requests/route";
import { readFileSync } from "node:fs";
import { STALE_REQUEST_HOURS } from "@/lib/service-requests";

const R = "11111111-1111-4111-8111-111111111111";
const T = "22222222-2222-4222-8222-222222222222";
beforeEach(() => { state.calls = []; });

it.each([["duplicate", true], ["created", false]])("answers the SQL's %s", async (answer, duplicate) => {
  state.answer = answer;
  const res = await POST(new NextRequest("https://test/api/service-requests", { method: "POST",
    body: JSON.stringify({ restaurantId: R, tableId: T, kind: "bill" }) }));
  expect(res.status).toBe(200);
  expect(Boolean((await res.json()).duplicate)).toBe(duplicate);
  expect(state.calls).toEqual([["raise_service_request_v1", { p_restaurant: R, p_table: T, p_kind: "bill", p_session: "s" }]]);
});

it("expires a call in SQL at the board's cutoff", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const fn = schema.slice(schema.indexOf("create or replace function public.raise_service_request_v1"));
  expect(fn.slice(0, fn.indexOf("end; $$;"))).toContain(`created_at >= now() - interval '${STALE_REQUEST_HOURS} hours'`);
});
