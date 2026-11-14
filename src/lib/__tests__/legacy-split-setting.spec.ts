import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const s = vi.hoisted(() => ({ enabled: true, readError: false, inserts: 0 }));
vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "member" }) }));
vi.mock("@/lib/table-session", () => ({ staffOpenedBill: async () => false }));
vi.mock("@/lib/table-party-server", () => ({ tableParty: async () => 2 }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: async () => [] }));
vi.mock("@/lib/table-bill", () => ({ tableBill: () => ({ total: 100 }) }));
vi.mock("@/lib/split-service", () => ({ currentSplit: async () => ({ id: "split" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async () => ({ error: null }),
  from: (table: string) => {
    const q = {
      select: () => q, eq: () => q,
      insert: () => { s.inserts++; return q; },
      single: async () => ({ data: { id: "split" }, error: null }),
      maybeSingle: async () => table === "restaurants"
        ? { data: { split_enabled: s.enabled }, error: s.readError ? { message: "unavailable" } : null }
        : { data: { id: "session", restaurant_id: "r", table_id: "t", closed_at: null }, error: null },
    }; return q;
  },
}) }));
import { POST } from "@/app/api/split/route";
const post = () => POST(new NextRequest("https://test/api/split", { method: "POST",
  body: JSON.stringify({ restaurantId: "r", tableId: "t", sessionId: "session", shares: 2 }) }));
beforeEach(() => { s.enabled = true; s.readError = false; s.inserts = 0; });

it("N5: the legacy proposal route also respects the owner's split switch", async () => {
  s.enabled = false;
  expect((await post()).status).toBe(403); expect(s.inserts).toBe(0);
});
it("N5: an unread split switch cannot create a legacy proposal", async () => {
  s.readError = true;
  expect((await post()).status).toBe(503); expect(s.inserts).toBe(0);
});
it("N5: an enabled restaurant can still propose a legacy split", async () => {
  expect((await post()).status).toBe(200); expect(s.inserts).toBe(1);
});
