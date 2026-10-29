import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const state = vi.hoisted(() => ({
  logs: new Map<string, Record<string, unknown>>(), operations: new Map<string, unknown>(),
  ref: "00000000-0000-4000-8000-000000000001", restaurant: "r", actor: "owner", failLog: false,
}));
vi.mock("@/lib/api-guard", () => ({
  actingStaff: async () => ({ restaurantId: state.restaurant, role: "owner", email: state.actor }),
  actingManager: async () => ({ restaurantId: state.restaurant, role: "owner", email: state.actor }),
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/cash-shift-server", () => ({ openShift: async () => ({ id: "shift" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    const key = JSON.stringify([args.p_restaurant, name, args.p_ref]);
    if (!state.operations.has(key)) state.operations.set(key,
      name === "record_waste_once" ? crypto.randomUUID()
        : name === "record_ingredient_counts_once" ? [{ ingredient_id: args.p_ingredient, counted: 2, expected: 3 }]
          : { id: crypto.randomUUID(), currency: "MXN", expected: 100, difference: 0 });
    return { data: state.operations.get(key), error: null };
  },
  from: (table: string) => {
    const write = (value: Record<string, unknown>, ignoreDuplicates = false) => {
      if (state.failLog) return { error: { message: "log unavailable" } };
      const id = String(value.id ?? crypto.randomUUID());
      if (!ignoreDuplicates || !state.logs.has(id)) state.logs.set(id, value);
      return { error: null };
    };
    if (table === "user_logs") return {
      insert: async (value: Record<string, unknown>) => write(value),
      upsert: async (value: Record<string, unknown>, options: { onConflict: string; ignoreDuplicates: boolean }) => {
        expect(options).toEqual({ onConflict: "id", ignoreDuplicates: true });
        return write(value, options.ignoreDuplicates);
      },
    };
    const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { name: "Milk", unit_cost: 2 }, error: null }) };
    return q;
  },
}) }));
import { logEvent } from "@/lib/activity-log";
import { POST as withdrawal } from "@/app/api/cash-drawer/route";
import { POST as shift } from "@/app/api/cash-shift/route";
import { POST as waste } from "@/app/api/costs/waste/route";
import { POST as counts } from "@/app/api/costs/counts/route";
const id = "00000000-0000-4000-8000-0000000000aa";
const cases = [
  ["withdrawal", withdrawal, { kind: "withdrawal", amount: 100, shiftId: id }],
  ["shift close", shift, { action: "close", confirm: true, counted: 100, shiftId: id }],
  ["waste", waste, { ingredientId: id, quantity: 2, reason: "spoiled" }],
  ["count", counts, { counts: [{ ingredientId: id, counted: 2 }] }],
] as const;
function send(post: typeof withdrawal, body: object): Promise<Response> {
  return post(new NextRequest("https://test/api/test", { method: "POST", body: JSON.stringify({ ...body, ref: state.ref }) }));
}
beforeEach(() => {
  state.logs.clear(); state.operations.clear(); state.restaurant = "r"; state.actor = "owner"; state.failLog = false;
  state.ref = "00000000-0000-4000-8000-000000000001";
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
it.each(cases)("logs a retried %s once, including concurrent retries", async (_name, post, body) => {
  expect((await send(post, body)).status).toBe(200);
  await Promise.all([send(post, body), send(post, body)]);
  expect(state.operations.size).toBe(1);
  expect(state.logs.size).toBe(1);
  expect([...state.logs.values()][0].actor_email).toBe("owner");
});
it.each(cases)("keeps %s activity after a retry by another actor and repairs a failed log", async (_name, post, body) => {
  state.failLog = true;
  expect((await send(post, body)).status).toBe(200);
  expect(state.logs.size).toBe(0);
  state.failLog = false;
  await send(post, body);
  const saved = [...state.logs.values()][0];
  state.actor = "manager";
  await send(post, body);
  expect(state.logs.size).toBe(1);
  expect([...state.logs.values()][0]).toEqual(saved);
});
it("keeps different operations, actions and restaurants separate", async () => {
  for (const [, post, body] of cases) expect((await send(post, body)).status).toBe(200);
  state.restaurant = "other";
  for (const [, post, body] of cases) expect((await send(post, body)).status).toBe(200);
  state.ref = "00000000-0000-4000-8000-000000000002";
  // A new withdrawal, waste entry and count are distinct operations. A shift closes once.
  for (const [, post, body] of cases.filter(([name]) => name !== "shift close")) expect((await send(post, body)).status).toBe(200);
  expect(state.logs.size).toBe(11);
});

it("namespaces the same operation key by action and restaurant and leaves unkeyed activity alone", async () => {
  const event = { restaurantId: "r", actor: "owner", entity: "cash", action: "created", operationKey: "operation" } as const;
  await logEvent(event);
  await logEvent(event);
  await logEvent({ ...event, action: "deleted" });
  await logEvent({ ...event, restaurantId: "other" });
  await logEvent({ ...event, operationKey: undefined });
  await logEvent({ ...event, operationKey: undefined });
  expect(state.logs.size).toBe(5);
});
