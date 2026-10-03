import { describe, expect, it } from "vitest";
import { existingTicket } from "@/lib/pos-sale";
import { orderCode } from "@/lib/types";

const dbWith = (row: { id: string; total: string } | null) => {
  const asked: unknown[][] = [];
  const query = {
    select: () => query,
    eq: (...a: unknown[]) => (asked.push(a), query),
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return { db: { from: () => query } as never, asked };
};

describe("a sale the till sends twice", () => {
  it("answers with the ticket it already rang, marked as a repeat", async () => {
    const id = "6b1f0c2e-0000-4000-8000-000000000001";
    const { db, asked } = dbWith({ id, total: "125.50" });
    const res = await existingTicket(db, "ref-1");
    expect(asked).toEqual([["pos_ref", "ref-1"]]);
    expect(await res?.json()).toEqual({ orderId: id, code: orderCode(id), total: 125.5, repeat: true });
  });

  it("answers nothing when there is no such sale, so it gets rung", async () => {
    expect(await existingTicket(dbWith(null).db, "ref-2")).toBeNull();
  });
});
