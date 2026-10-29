import { beforeEach, describe, expect, it, vi } from "vitest";
import { ORDER, REF, operation, prepared, returnFixture, returnRequest } from "./returns-contract-fixtures";

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "manager", role: "manager" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { POST } from "@/app/api/order-refunds/route";

let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  vi.clearAllMocks(); fixture = returnFixture();
  db.rpc.mockImplementation(fixture.rpc); db.from.mockImplementation(fixture.from);
});

describe("preparing a return on a completed sale", () => {
  it("reserves principal across mixed principal and tip receipts before returning any tip", async () => {
    // The card's 50 includes 10 tip. Returning 50 principal needs 40 card + 10 cash.
    const operations = [operation("card-return", "stripe", 40), operation("cash-return", "cash", 10)];
    const plan = prepared({ total: 80, tip: 10, service_fee: 0 }, { total: 30, tip: 10, service_fee: 0 }, operations);
    fixture.rpc.mockResolvedValue({ data: plan, error: null });
    const response = await POST(returnRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(plan);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("return_on_order_v1", {
      p_restaurant: "r1", p_order: ORDER, p_amount_cents: 5000, p_actor: "manager", p_reason: "quality",
      p_note: "Cold meal", p_ref: REF, p_expected_total_cents: 8000, p_expected_tip_cents: 1000, p_expected_service_cents: 0,
    });
    expect(fixture.tables.orders[0]).toMatchObject({ paid: true, status: "completed" });
  });

  it("returns the collected 80 after a 20 forgiveness without reopening the forgiven debt", async () => {
    fixture.tables.orders[0] = { ...fixture.tables.orders[0], total: 80, tip: 0 };
    fixture.tables.order_adjustments = [{ id: "forgiveness", kind: "forgive", amount: 20, order_id: ORDER }];
    const before = structuredClone(fixture.tables);
    const plan = prepared({ total: 80, tip: 0, service_fee: 0 }, { total: 0, tip: 0, service_fee: 0 }, [operation("return-80", "cash", 80)]);
    fixture.rpc.mockResolvedValue({ data: plan, error: null });
    const response = await POST(returnRequest({ amountCents: 8000, expected: { totalCents: 8000, tipCents: 0, serviceCents: 0 } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject(plan);
    // Only SQL may commit the transition; the route must not rewrite old events or stock.
    expect(fixture.tables).toEqual(before);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("return_on_order_v1", expect.objectContaining({ p_amount_cents: 8000 }));
  });

  it("exhausts food and service together before returning the remaining tip", async () => {
    // Principal 90 food + 10 service: a 50 return removes 45 food + 5 service.
    const first = prepared({ total: 110, tip: 10, service_fee: 10 }, { total: 60, tip: 10, service_fee: 5 }, [operation("first", "cash", 50)]);
    const second = prepared({ total: 60, tip: 10, service_fee: 5 }, { total: 10, tip: 10, service_fee: 0 }, [operation("second", "cash", 50)]);
    const last = prepared({ total: 10, tip: 10, service_fee: 0 }, { total: 0, tip: 0, service_fee: 0 }, [operation("last", "cash", 10, 10)]);
    fixture.rpc.mockResolvedValueOnce({ data: first, error: null }).mockResolvedValueOnce({ data: second, error: null }).mockResolvedValueOnce({ data: last, error: null });
    for (const [index, plan] of [first, second, last].entries()) {
      const previous = plan.previous as { total: number; tip: number; service_fee: number };
      const response = await POST(returnRequest({ ref: `44444444-4444-4444-8444-44444444444${index}`, amountCents: plan.amount_cents,
        expected: { totalCents: previous.total * 100, tipCents: previous.tip * 100, serviceCents: previous.service_fee * 100 } }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(plan);
    }
    expect(db.rpc).toHaveBeenCalledTimes(3);
  });

  it("routes a duplicate-payment correction to refunds_due and leaves the legitimate sale intact", async () => {
    const response = await POST(returnRequest({ action: "prepare", dueId: "duplicate-charge" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "apiErr.duplicateRefundUseDue" });
    expect(db.rpc).not.toHaveBeenCalled();
    expect(fixture.tables.orders[0]).toMatchObject({ total: 80, paid: true, status: "completed" });
    expect(fixture.tables.refund_operations).toEqual([]);
  });
});
