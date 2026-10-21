import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";

vi.mock("@/lib/table-membership", () => ({ tableMember: async () => ({ id: "phone", sessionId: "cheap-sitting", closed: false }) }));
const { rpc, bill } = vi.hoisted(() => ({ rpc: vi.fn(), bill: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ isRoomLimited: async () => false, isTableLimited: async () => false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/bill-data", () => ({ fetchTableBill: bill }));
vi.mock("@/lib/split-service", () => ({ currentSplit: async () => null, writeShares: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc,
  from: () => { const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: null }) }; return q; },
}) }));
const { POST } = await import("../route");
const schema = readFileSync("supabase/schema.sql", "utf8");
beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  bill.mockReset().mockResolvedValue([{ id: "cheap", total: 20, paid: false, status: "received" }]);
});
it("hands all sitting capabilities to the join transaction instead of another table's amount", async () => {
  const response = await POST(new NextRequest("http://localhost/api/split/join", { method: "POST", body: JSON.stringify({
    splitId: "expensive-split", diner: "phone", restaurantId: "cheap-restaurant", tableId: "cheap-table", sessionId: "cheap-sitting",
  }) }));
  expect(response.status).toBe(409);
  expect(rpc).toHaveBeenCalledWith("join_bill_split_v2", {
    p_split: "expensive-split", p_diner: "phone", p_restaurant: "cheap-restaurant", p_table: "cheap-table", p_session: "cheap-sitting",
  });
  expect(bill).not.toHaveBeenCalled();
});
it("derives the freeze from locked orders of the split's own sitting", () => {
  const join = schema.split("create or replace function public.join_bill_split_v2(")[1]?.split("end; $$;")[0];
  expect(join).toContain("v_split.session_id is distinct from p_session");
  expect(join).toContain("v_sitting.table_id is distinct from p_table");
  expect(join).toContain("sum(greatest(total - public.retained_order_coverage(p_restaurant, id), 0))");
  expect(join).toContain("session_id = v_split.session_id");
  expect(join).not.toContain("p_amount");
});
it("checks collected credit and share completeness inside the close transaction", () => {
  const close = schema.split("create or replace function public.close_divided_bill_v2(")[1]?.split("end; $$;")[0];
  expect(close).toContain("v_count <> v_split.shares");
  expect(close).toContain("public.retained_order_coverage(v_split.restaurant_id, o.id) < o.total");
  expect(close).toContain("for update");
});
