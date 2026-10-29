import { describe, expect, it, vi } from "vitest";
import { existingTicket } from "@/lib/pos-sale";
import { orderCode } from "@/lib/types";

vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));

const dbWith = (row: { id: string; total: string; paid?: boolean; status?: string } | null) => {
  const asked: unknown[][] = [];
  const query = {
    select: () => query,
    eq: (...a: unknown[]) => (asked.push(a), query),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { db: { from: () => query, rpc: async () => ({ error: null, data: row && {
    outcome: "settled", settled: true, repeat: true, orderId: row.id, total: Number(row.total), handedOver: row.status === "completed",
  } }) } as never, asked };
};

describe("a sale the till sends twice", () => {
  it("answers with the ticket it already rang, marked as a repeat", async () => {
    const id = "6b1f0c2e-0000-4000-8000-000000000001";
    const { db, asked } = dbWith({ id, total: "125.50", paid: true, status: "completed" });
    const res = await existingTicket(db, "ref-1", "r");
    expect(asked).toEqual([["pos_ref", "ref-1"], ["restaurant_id", "r"]]);
    expect(await res?.json()).toEqual({ orderId: id, code: orderCode(id), total: 125.5, outcome: "settled", settled: true, repeat: true, handedOver: true });
  });

  it("answers nothing when there is no such sale, so it gets rung", async () => {
    expect(await existingTicket(dbWith(null).db, "ref-2", "r")).toBeNull();
  });
});

it("W1.2 refuses an unsettled repeat", async () => {
  const { db } = dbWith({ id: "id", total: "100", paid: false, status: "pending_payment" });
  const response = await existingTicket(db, "ref", "restaurant");
  expect(response?.status).toBe(409);
});
it("W1.3 scopes the retry lookup to its restaurant", async () => {
  const { db, asked } = dbWith(null);
  await existingTicket(db, "ref", "restaurant");
  expect(asked).toContainEqual(["restaurant_id", "restaurant"]);
});

it("never acknowledges a pending ticket even if its paid flag is inconsistent", async () => {
  const { db } = dbWith({ id: "id", total: "100", paid: true, status: "pending_payment" });
  expect((await existingTicket(db, "ref", "restaurant"))?.status).toBe(409);
});
