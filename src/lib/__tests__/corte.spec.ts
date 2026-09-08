import { describe, expect, it } from "vitest";
import { EMPTY_CORTE, corteFrom } from "@/lib/corte";

/** A row of `payments`, taken by a member of staff. */
const took = (actor_email: string, amount: number, method: string) => ({
  actor_email,
  amount,
  method,
});

/** A row of the activity log: money somebody decided not to collect. */
const gaveUp = (action: string, amount: number) => ({ action, detail: `amount=${amount}` });

describe("closing the register", () => {
  it("counts each drawer separately, because each is counted by its own person", () => {
    const corte = corteFrom([
      took("ana@x.dev", 100, "cash"),
      took("ana@x.dev", 50, "card"),
      took("beto@x.dev", 30, "cash"),
    ]);
    expect(corte.people.map(p => p.actor)).toEqual(["ana@x.dev", "beto@x.dev"]);
    expect(corte.people[0]).toMatchObject({ count: 2, total: 150, cash: 100, card: 50 });
    expect(corte.people[1]).toMatchObject({ count: 1, total: 30, cash: 30, card: 0 });
  });

  it("puts the busiest drawer first", () => {
    const corte = corteFrom([took("small@x.dev", 10, "cash"), took("big@x.dev", 900, "cash")]);
    expect(corte.people[0].actor).toBe("big@x.dev");
  });

  it("totals everyone together", () => {
    const corte = corteFrom([took("a@x.dev", 100, "cash"), took("b@x.dev", 40, "card")]);
    expect(corte.totals).toMatchObject({ count: 2, total: 140, cash: 100, card: 40 });
  });

  it("keeps money paid online out of every drawer", () => {
    // Nobody was standing there to take it, so it is in no one's till — but it
    // is real money, and the log this used to be built from never saw it at all.
    const corte = corteFrom([
      took("ana@x.dev", 100, "cash"),
      { actor_email: null, amount: 250, method: "card" },
    ]);
    expect(corte.people).toHaveLength(1);
    expect(corte.totals.total).toBe(100);
    expect(corte.online).toBe(250);
  });

  it("states what never arrived apart from what did", () => {
    // A corte that only shows takings cannot be reconciled against a night
    // where somebody walked out.
    const corte = corteFrom(
      [took("a@x.dev", 100, "cash")],
      [gaveUp("written_off", 80), gaveUp("discounted", 15.5)],
    );
    expect(corte.totals.total).toBe(100);
    expect(corte.writtenOff).toBe(80);
    expect(corte.discounted).toBe(15.5);
  });

  it("does not count a write-off as somebody's takings", () => {
    const corte = corteFrom([], [gaveUp("written_off", 80)]);
    expect(corte.people).toEqual([]);
    expect(corte.totals.total).toBe(0);
    expect(corte.writtenOff).toBe(80);
  });

  it("has nothing to show before the first payment of the day", () => {
    expect(corteFrom([])).toEqual(EMPTY_CORTE);
  });
});
