import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const db = vi.hoisted(() => ({ round: 0, used: 0, saved: new Map<string, unknown>(), calls: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => ({ restaurantId: "r1", email: "waiter@test" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: (table: string) => {
    const data = table === "loyalty_cards" ? { id: "c1", goal: 2, steps: [{ visits: 2, reward: "MX$50" }], round_no: db.round }
      : table === "loyalty_programs" ? { goal: 2, reward: "MX$50", steps: [] } : [];
    const q: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in"]) q[method] = () => q;
    q.maybeSingle = async () => ({ data, error: null });
    q.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve);
    return q;
  },
  // Model the locked RPC contract, with four banked visits: both rounds are
  // ready, so counting HTTP successes alone cannot catch the second reward.
  rpc: async (name: string, args: Record<string, unknown>) => {
    db.calls(name, args);
    if (name === "loyalty_progress") return { data: 4 - db.used * 2, error: null };
    if (name === "loyalty_redeem_once") {
      const key = String(args.p_request_key);
      const prior = db.saved.get(key);
      if (prior) return { data: prior, error: null };
      if (args.p_round !== db.round) return { data: { error: "roundChanged" }, error: null };
      db.used++; db.round++;
      const result = { progress: 4 - db.used * 2, goal: 2, reward: "MX$50", round_no: db.round, steps: [{ visits: 2, reward: "MX$50" }], done: [] };
      db.saved.set(key, result);
      return { data: result, error: null };
    }
    db.used++; db.round++;
    return { data: [{ progress: 4 - db.used * 2, goal: 2, reward: "MX$50" }], error: null };
  },
}) }));
import { POST } from "@/app/api/loyalty/redeem/route";
const intent = { code: "K7QM3XW9TB4R", step: 2, round: 0, requestKey: "d21c4073-210b-465b-881e-2445b98fc66f" };
const post = (body: unknown = intent) => POST(new NextRequest("https://test/api/loyalty/redeem", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { db.round = 0; db.used = 0; db.saved.clear(); db.calls.mockClear(); });

it("S15 two concurrent requests for one handover consume one reward and return the same result", async () => {
  const responses = await Promise.all([post(), post()]);
  expect(responses.map(r => r.status)).toEqual([200, 200]);
  expect(db.used).toBe(1);
  expect(await responses[0].json()).toEqual(await responses[1].json());
});
it("S15 a lost response replays the original result after the card advances again", async () => {
  const original = await (await post()).json();
  db.round = 4;
  expect(await (await post()).json()).toEqual(original);
  expect(db.used).toBe(1);
});
it("S15 a different tap on the displayed old round cannot consume the next round", async () => {
  await post();
  const response = await post({ ...intent, requestKey: "a21c4073-210b-465b-881e-2445b98fc66f" });
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.loyaltyRoundChanged" });
  expect(db.used).toBe(1);
});
it("S15 validates the complete displayed reward identity before calling the database", async () => {
  for (const change of [{ round: undefined }, { round: -1 }, { round: 0.5 }, { round: 2147483648 }, { step: null }, { step: 1 }, { requestKey: undefined }, { requestKey: "bad" }]) {
    expect((await post({ ...intent, ...change })).status, JSON.stringify(change)).toBe(400);
  }
  expect(db.calls).not.toHaveBeenCalled();
});
