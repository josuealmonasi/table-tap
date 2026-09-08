import { describe, expect, it } from "vitest";
import { EMPTY_TILL, tillFrom } from "@/lib/till";

/** A row of `payments`. Postgres hands `numeric` over as a string. */
const paid = (amount: number | string, method: string) => ({ amount, method });

describe("counting one person's takings", () => {
  it("adds up what they collected, split by method", () => {
    const till = tillFrom([paid(25, "cash"), paid(120.5, "cash"), paid(80, "card")]);
    expect(till).toEqual({ count: 3, total: 225.5, cash: 145.5, card: 80 });
  });

  it("reads the string Postgres sends for a numeric column", () => {
    // supabase-js hands `numeric` back as "25.00", not 25. Counting those as
    // text would concatenate the day's takings instead of adding them.
    const till = tillFrom([paid("25.00", "cash"), paid("120.50", "cash")]);
    expect(till.cash).toBe(145.5);
  });

  it("keeps cash apart, because that is the part that has to be in the drawer", () => {
    const till = tillFrom([paid(10, "card"), paid(10, "cash")]);
    expect(till.cash).toBe(10);
    expect(till.card).toBe(10);
    expect(till.total).toBe(20);
  });

  it("counts a row it cannot read but does not invent an amount", () => {
    // Dropping it would quietly disagree with the ledger an owner reads.
    const till = tillFrom([paid(25, "cash"), paid("not a number", "cash")]);
    expect(till.count).toBe(2);
    expect(till.total).toBe(25);
  });

  it("does not put an unknown method into either pile", () => {
    const till = tillFrom([paid(40, "transfer")]);
    expect(till.total).toBe(40);
    expect(till.cash + till.card).toBe(0);
  });

  it("rounds once at the end, so the split still adds to the total", () => {
    const till = tillFrom([paid(10.005, "cash"), paid(10.005, "cash")]);
    expect(till.cash).toBe(till.total);
  });

  it("has nothing to say before the first payment", () => {
    expect(tillFrom([])).toEqual(EMPTY_TILL);
  });
});
