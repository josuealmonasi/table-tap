import { describe, expect, it } from "vitest";
import { EMPTY_CORTE, corteFrom } from "@/lib/corte";

const paid = (actor: string, amount: number, method: string) => ({
  actor,
  entity: "bill",
  action: "paid",
  detail: `orders=1 amount=${amount} method=${method}`,
});

describe("closing the register", () => {
  it("counts each drawer separately, because each is counted by its own person", () => {
    const corte = corteFrom([
      paid("ana@x.dev", 100, "cash"),
      paid("ana@x.dev", 50, "card"),
      paid("beto@x.dev", 30, "cash"),
    ]);
    expect(corte.people.map(p => p.actor)).toEqual(["ana@x.dev", "beto@x.dev"]);
    expect(corte.people[0]).toMatchObject({ count: 2, total: 150, cash: 100, card: 50 });
    expect(corte.people[1]).toMatchObject({ count: 1, total: 30, cash: 30, card: 0 });
  });

  it("puts the busiest drawer first", () => {
    const corte = corteFrom([paid("small@x.dev", 10, "cash"), paid("big@x.dev", 900, "cash")]);
    expect(corte.people[0].actor).toBe("big@x.dev");
  });

  it("totals everyone together", () => {
    const corte = corteFrom([paid("a@x.dev", 100, "cash"), paid("b@x.dev", 40, "card")]);
    expect(corte.totals).toMatchObject({ count: 2, total: 140, cash: 100, card: 40 });
  });

  it("states what never arrived apart from what did", () => {
    // A corte that only shows takings cannot be reconciled against a night
    // where somebody walked out.
    const corte = corteFrom([
      paid("a@x.dev", 100, "cash"),
      { actor: "m@x.dev", entity: "bill", action: "written_off", detail: "amount=80" },
      { actor: "m@x.dev", entity: "discount", action: "discounted", detail: "amount=15.50" },
    ]);
    expect(corte.totals.total).toBe(100);
    expect(corte.writtenOff).toBe(80);
    expect(corte.discounted).toBe(15.5);
  });

  it("does not count a write-off as somebody's takings", () => {
    const corte = corteFrom([
      { actor: "m@x.dev", entity: "bill", action: "written_off", detail: "amount=80" },
    ]);
    expect(corte.people).toEqual([]);
    expect(corte.totals.total).toBe(0);
  });

  it("has nothing to show before the first payment of the day", () => {
    expect(corteFrom([])).toEqual(EMPTY_CORTE);
  });
});
