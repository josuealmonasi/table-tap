import { beforeEach, describe, expect, it, vi } from "vitest";
import { REF, REF_TWO, operation, prepared, returnFixture, returnRequest } from "./returns-contract-fixtures";

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "manager", role: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { POST } from "@/app/api/order-refunds/route";

let fixture: ReturnType<typeof returnFixture>;
const plan = prepared({ total: 80, tip: 10, service_fee: 0 }, { total: 0, tip: 0, service_fee: 0 }, [operation("all", "cash", 80, 10)]);
beforeEach(() => {
  vi.clearAllMocks(); fixture = returnFixture();
  db.rpc.mockImplementation(fixture.rpc); db.from.mockImplementation(fixture.from);
});

describe("a return reference is an immutable request", () => {
  it("returns one saved result for racing identical references", async () => {
    // These are serialized SQL answers. Only the integration gate proves the lock.
    fixture.rpc.mockResolvedValueOnce({ data: plan, error: null })
      .mockResolvedValueOnce({ data: { ...plan, replay: true }, error: null });
    const responses = await Promise.all([POST(returnRequest({ amountCents: 8000 })), POST(returnRequest({ amountCents: 8000 }))]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    const results = await Promise.all(responses.map(r => r.json()));
    expect(results.map(r => r.adjustment)).toEqual(["adjustment-1", "adjustment-1"]);
    expect(results.map(r => r.replay)).toEqual([false, true]);
    expect(db.rpc.mock.calls.map(([, args]) => args.p_ref)).toEqual([REF, REF]);
  });

  it("conflicts when a racing request changes the amount under the same reference", async () => {
    fixture.rpc.mockResolvedValueOnce({ data: plan, error: null }).mockResolvedValueOnce({ data: { outcome: "conflict" }, error: null });
    const first = await POST(returnRequest({ amountCents: 8000 }));
    const changed = await POST(returnRequest({ amountCents: 7000 }));
    expect([first.status, changed.status]).toEqual([200, 409]);
    expect(db.rpc.mock.calls.map(([, args]) => [args.p_ref, args.p_amount_cents])).toEqual([[REF, 8000], [REF, 7000]]);
  });

  it("replays before fresh eligibility checks when a full return has left zero", async () => {
    fixture.tables.orders[0].total = 0;
    fixture.tables.orders[0].tip = 0;
    fixture.rpc.mockResolvedValue({ data: { ...plan, replay: true }, error: null });
    const response = await POST(returnRequest({ amountCents: 8000 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ adjustment: "adjustment-1", replay: true });
    expect(db.rpc).toHaveBeenCalledOnce();
  });

  it("rejects the second distinct reference against the same reviewed balance", async () => {
    const partial = prepared({ total: 80, tip: 10, service_fee: 0 }, { total: 20, tip: 10, service_fee: 0 }, [operation("first-60", "cash", 60)]);
    fixture.rpc.mockResolvedValueOnce({ data: partial, error: null }).mockResolvedValueOnce({ data: { outcome: "changed" }, error: null });
    const responses = await Promise.all([POST(returnRequest({ amountCents: 6000 })), POST(returnRequest({ amountCents: 6000, ref: REF_TWO }))]);
    expect(responses.map(r => r.status)).toEqual([200, 409]);
    expect(db.rpc.mock.calls.map(([, args]) => args.p_ref)).toEqual([REF, REF_TWO]);
    expect(db.rpc.mock.calls.map(([, args]) => args.p_expected_total_cents)).toEqual([8000, 8000]);
  });
});
