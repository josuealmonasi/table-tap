import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ role: "manager", restaurant: "r1", email: "guest@example.com" as string | null, code: "ZMYKTJ6GDA2Y", logs: 0 }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ["owner", "manager"].includes(state.role) ? { restaurantId: state.restaurant, email: "staff@example.com" } : null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ error: key }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "client", isRateLimited: async () => false }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => { state.logs++; } }));
vi.mock("@/lib/accounts-server", () => ({
  accountById: async (restaurant: string, id: string) => restaurant === "r1" && id === "a1" ? { id, restaurant_id: "r1", name: "Guest", email: state.email, code: state.code } : null,
  accountByCode: async (code: string) => code === state.code ? { id: "a1", restaurant_id: "r1", name: "Guest", email: state.email, code } : null,
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update: () => {
  const filters: Record<string, string> = {};
  const query = { eq: (key: string, value: string) => { filters[key] = value; return query; }, select: () => ({ maybeSingle: async () => {
    if (filters.id !== "a1" || filters.restaurant_id !== "r1" || (filters.code && filters.code !== state.code)) return { data: null, error: null };
    state.email = null; return { data: { id: "a1" }, error: null };
  } }) };
  return query;
} }) }) }));
import { POST } from "@/app/api/account/remove-email/route";
const send = (body: object) => POST(new NextRequest("http://localhost/api/account/remove-email", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { state.role = "manager"; state.restaurant = "r1"; state.email = "guest@example.com"; state.code = "ZMYKTJ6GDA2Y"; state.logs = 0; });
it.each(["owner", "manager"])("lets a %s remove their restaurant's account email", async role => { state.role = role; expect((await send({ id: "a1" })).status).toBe(200); expect(state.email).toBeNull(); expect(state.logs).toBe(1); });
it.each(["waiter", "cashier", "kitchen"])("refuses a %s", async role => { state.role = role; expect((await send({ id: "a1" })).status).toBe(403); expect(state.email).not.toBeNull(); });
it("refuses another restaurant", async () => { state.restaurant = "r2"; expect((await send({ id: "a1" })).status).toBe(404); expect(state.email).not.toBeNull(); });
it("lets the code holder remove the address and retry", async () => { expect((await send({ c: state.code })).status).toBe(200); expect(state.email).toBeNull(); expect((await send({ c: state.code })).status).toBe(200); expect(state.logs).toBe(1); });

it("refuses an unknown code", async () => { expect((await send({ c: "000000000000" })).status).toBe(404); expect(state.email).not.toBeNull(); });
