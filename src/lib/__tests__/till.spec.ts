import { describe, expect, it } from "vitest";
import { EMPTY_TILL, tillFrom } from "@/lib/till";

const row = (detail: string | null) => ({ detail });

describe("counting one person's takings", () => {
  it("adds up what they collected, split by method", () => {
    const till = tillFrom([
      row("orders=1 amount=25.00 method=cash"),
      row("table=4 orders=2 amount=120.50 method=cash"),
      row("orders=1 amount=80.00 method=card"),
    ]);
    expect(till).toEqual({ count: 3, total: 225.5, cash: 145.5, card: 80 });
  });

  it("keeps cash apart, because that is the part that has to be in the drawer", () => {
    const till = tillFrom([row("amount=10 method=card"), row("amount=10 method=cash")]);
    expect(till.cash).toBe(10);
    expect(till.card).toBe(10);
    expect(till.total).toBe(20);
  });

  it("counts a row it cannot read but does not invent an amount", () => {
    // Dropping it would quietly disagree with the log a manager reads.
    const till = tillFrom([row("amount=25 method=cash"), row("something odd"), row(null)]);
    expect(till.count).toBe(3);
    expect(till.total).toBe(25);
  });

  it("does not put an unknown method into either pile", () => {
    const till = tillFrom([row("amount=40 method=transfer")]);
    expect(till.total).toBe(40);
    expect(till.cash + till.card).toBe(0);
  });

  it("rounds once at the end, so the split still adds to the total", () => {
    const till = tillFrom([
      row("amount=10.005 method=cash"),
      row("amount=10.005 method=cash"),
    ]);
    expect(till.cash).toBe(till.total);
  });

  it("has nothing to say before the first payment", () => {
    expect(tillFrom([])).toEqual(EMPTY_TILL);
  });
});
