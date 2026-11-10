import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({ columns: "" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const query = {
    select: (columns: string) => { state.columns = columns; return query; }, eq: () => query,
    maybeSingle: async () => ({ error: null, data: Object.fromEntries(Object.entries({
      id: "00000000-0000-4000-8000-000000000001", restaurant_id: "r", status: "received", paid: false,
      items: [], total: 20, currency: "MXN", tip: 0, service_fee: 0, customer_name: "Private diner",
    }).filter(([key]) => state.columns.split(", ").includes(key))) }),
  };
  return query;
} }) }));
vi.mock("@/lib/return-components", () => ({ readReturnAdjustments: async () => [] }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "phone", forTheRoom: (n: number) => n, isRateLimited: async () => false }));
import { fetchTrackedOrder } from "@/lib/order-tracking";
import { GET } from "@/app/api/order-status/route";
const id = "00000000-0000-4000-8000-000000000001";
beforeEach(() => { state.columns = ""; });
it("L2: the public reader used by the tracker page and QR never selects a diner name", async () => {
  const order = await fetchTrackedOrder(id);
  expect(state.columns).not.toContain("customer_name");
  expect(order).not.toHaveProperty("customer_name");
  expect(order).toMatchObject({ id, total: 20, status: "received" });
});
it("L2: a shared status link exposes no diner name", async () => {
  const response = await GET(new NextRequest(`https://test/api/order-status?id=${id}`));
  expect(response.status).toBe(200);
  expect(await response.json()).not.toHaveProperty("customer_name");
});
