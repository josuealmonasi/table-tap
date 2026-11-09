import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ createdAt: "", inserted: 0, cutoff: "" }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/legacy-bill-access", () => ({ ownBillAccess: async () => ({}) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q,
    gte: (_column: string, cutoff: string) => { state.cutoff = cutoff; return q; },
    single: async () => ({ data: { id: "table", label: "1" }, error: null }),
    limit: async () => ({ data: state.createdAt >= state.cutoff ? [{ id: "old" }] : [], error: null }),
    insert: async () => { state.inserted++; return { error: null }; },
  };
  expect(["restaurant_tables", "service_requests"]).toContain(table);
  return q;
} }) }));
import { POST } from "@/app/api/service-requests/route";
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T12:00:00Z")); state.inserted = 0; state.cutoff = ""; });
afterEach(() => vi.useRealTimers());
it.each([
  ["2026-10-29T03:59:59.999Z", false],
  ["2026-10-29T04:00:00.000Z", true],
  ["2026-10-29T04:00:00.001Z", true],
])("deduplicates only a still-visible request from %s", async (createdAt, duplicate) => {
  state.createdAt = createdAt;
  const res = await POST(new NextRequest("https://test/api/service-requests", { method: "POST",
    body: JSON.stringify({ restaurantId: "r", tableId: "table", kind: "bill" }) }));
  expect(res.status).toBe(200);
  expect(Boolean((await res.json()).duplicate)).toBe(duplicate);
  expect(state.inserted).toBe(duplicate ? 0 : 1);
  expect(state.cutoff).toBe("2026-10-29T04:00:00.000Z");
});
