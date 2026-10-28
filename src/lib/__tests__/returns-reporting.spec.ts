import { beforeEach, describe, expect, it, vi } from "vitest";
import { returnFixture } from "./returns-contract-fixtures";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { foodRevenue } from "@/lib/report-revenue";

const db = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
import { returnedAdjustments } from "@/lib/refunds/adjustments";
import { corteFrom } from "@/lib/corte";

let fixture: ReturnType<typeof returnFixture>;
beforeEach(() => {
  vi.clearAllMocks(); fixture = returnFixture(); db.from.mockImplementation(fixture.from);
});

describe("a return keeps the sale and has its own completion day", () => {
  it("deducts each mixed-method completion on its own side of local midnight", async () => {
    fixture.tables.refund_operations = [
      { id: "card", restaurant_id: "r1", currency: "MXN", source: "stripe", amount: 40, status: "succeeded",
        created_at: "2026-10-29T05:58:00Z", completed_at: "2026-10-29T05:59:00Z", payout_actor: null },
      { id: "cash", restaurant_id: "r1", currency: "MXN", source: "cash", amount: 10, status: "pending",
        created_at: "2026-10-29T05:58:00Z", completed_at: null, payout_actor: "manager" },
      { id: "other-currency", restaurant_id: "r1", currency: "USD", source: "stripe", amount: 999, status: "succeeded", completed_at: "2026-10-29T05:59:00Z" },
      { id: "other-tenant", restaurant_id: "r2", currency: "MXN", source: "stripe", amount: 999, status: "succeeded", completed_at: "2026-10-29T05:59:00Z" },
    ];
    const readDay = async (from: string, to: string) => corteFrom([], await returnedAdjustments("r1", from, to, "MXN"));
    const before = await readDay("2026-10-28T06:00:00Z", "2026-10-29T05:59:59.999Z");
    expect(before).toMatchObject({ refunded: 40, online: -40, totals: { total: 0 } });
    Object.assign(fixture.tables.refund_operations[1], { status: "succeeded", completed_at: "2026-10-29T06:01:00Z" });
    expect(await readDay("2026-10-28T06:00:00Z", "2026-10-29T05:59:59.999Z")).toEqual(before);
    const after = await readDay("2026-10-29T06:00:00Z", "2026-10-30T05:59:59.999Z");
    expect(after).toMatchObject({ refunded: 10, online: 0, totals: { total: -10 } });
    expect(after.people).toEqual(expect.arrayContaining([expect.objectContaining({ actor: "manager", cash: -10, total: -10 })]));
  });

  it("keeps yesterday's food revenue while today's return completes across midnight", () => {
    const order = { items: [], total: 30, tip: 10, service_fee: 0,
      // Readers restore all reserved return components before computing the sale.
      return_components: { total: 50, tip: 0, service_fee: 0 } };
    expect(foodRevenue(order)).toBe(70);
  });

  it("shows original, completed, pending and retained amounts on a receipt", () => {
    const order: ReceiptOrder & { return_components: object; returns: object[] } = {
      id: "11111111-1111-4111-8111-111111111111", items: [], subtotal: 70, total: 30, tip: 10,
      service_fee: 0, currency: "MXN", created_at: "2026-10-27T18:00:00Z",
      return_components: { total: 50, tip: 0, service_fee: 0 }, returns: [
        { id: "card", source: "stripe", amount: 40, tip: 0, status: "succeeded", completed_at: "2026-10-29T05:59:00Z" },
        { id: "cash", source: "cash", amount: 10, tip: 0, status: "pending", completed_at: null },
      ],
    };
    const receipt = buildReceipt([order], { name: "Restaurant", timeZone: "America/Mexico_City", locale: "en-US" }, key => key);
    for (const [key, amount] of [["original", 80], ["returned", 40], ["returnPending", 10], ["retained", 30]] as const) {
      expect(receipt.text).toContain(`receipt.${key}  MX$${amount.toFixed(2)}`);
      expect(receipt.html).toContain(`receipt.${key}`);
      expect(receipt.html).toContain(`MX$${amount.toFixed(2)}`);
    }
  });
});

it("uses an exclusive upper bound so an exact-midnight return belongs to one day", async () => {
  fixture.tables.refund_operations = [{ id: "midnight", restaurant_id: "r1", currency: "MXN", source: "cash", amount: 10,
    status: "succeeded", completed_at: "2026-10-29T06:00:00Z", payout_actor: "manager" }];
  expect(await returnedAdjustments("r1", "2026-10-28T06:00:00Z", "2026-10-29T06:00:00Z", "MXN")).toEqual([]);
  expect(await returnedAdjustments("r1", "2026-10-29T06:00:00Z", "2026-10-30T06:00:00Z", "MXN")).toHaveLength(1);
});
