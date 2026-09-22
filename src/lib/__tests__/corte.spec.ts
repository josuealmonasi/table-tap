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

/**
 * Money handed back. Unlike a write-off, this DID arrive — it sat in one
 * person's drawer — and then left it. A cash sale cancelled after #337 kept its
 * payment and logged nothing the corte could read, so the corte went on
 * expecting the cash and called the waiter who handed it back short by exactly
 * that amount.
 */
const handedBack = (collector: string | null, amount: number, method: string) => ({
  action: "refunded",
  detail: `order=abc12345 amount=${amount} method=${method}${collector ? ` collector=${collector}` : ""}`,
});

describe("money handed back after it arrived", () => {
  it("comes out of the drawer of whoever took it, not whoever cancelled", () => {
    const corte = corteFrom(
      [took("ana@x.dev", 100, "cash"), took("ana@x.dev", 40, "cash"), took("beto@x.dev", 30, "cash")],
      [handedBack("ana@x.dev", 100, "cash")],
    );
    const ana = corte.people.find(p => p.actor === "ana@x.dev")!;
    const beto = corte.people.find(p => p.actor === "beto@x.dev")!;
    // Ana took 140 and handed 100 back: her drawer should hold 40.
    expect(ana.cash).toBe(40);
    expect(ana.total).toBe(40);
    // Beto is untouched.
    expect(beto.cash).toBe(30);
    // And it is said out loud, so the drawer and the screen agree for a reason.
    expect(corte.refunded).toBe(100);
  });

  it("takes a card refund off the card column, which does not have to match a drawer", () => {
    const corte = corteFrom(
      [took("ana@x.dev", 60, "cash"), took("ana@x.dev", 80, "card")],
      [handedBack("ana@x.dev", 80, "card")],
    );
    const ana = corte.people[0];
    expect(ana.card).toBe(0);
    expect(ana.cash).toBe(60);
  });

  it("does not count the refund as a payment somebody took", () => {
    const corte = corteFrom([took("ana@x.dev", 100, "cash")], [handedBack("ana@x.dev", 100, "cash")]);
    expect(corte.people[0].count).toBe(1);
  });

  it("takes a refund of an online payment off the online total, not a drawer", () => {
    // Nobody was holding a till when the diner paid, so nobody's drawer
    // changes when it goes back.
    const corte = corteFrom(
      [{ actor_email: null, amount: 90, method: "card" }, took("ana@x.dev", 50, "cash")],
      [handedBack(null, 90, "card")],
    );
    expect(corte.online).toBe(0);
    expect(corte.people[0].cash).toBe(50);
  });

  it("keeps the totals equal to the drawers summed", () => {
    const corte = corteFrom(
      [took("ana@x.dev", 100, "cash"), took("beto@x.dev", 70, "cash")],
      [handedBack("ana@x.dev", 25, "cash")],
    );
    const summed = corte.people.reduce((n, p) => n + p.cash, 0);
    expect(corte.totals.cash).toBe(summed);
    expect(corte.totals.cash).toBe(145);
  });

  it("shows a refund of last night's sale in this morning's drawer", () => {
    // Rung up at 23:50, cancelled at 09:00. The payment is in yesterday's
    // window and the handback is in today's, so today Beto has taken nothing
    // and given MX$60 back — and his drawer really does hold MX$60 less than
    // today's takings say. Hiding him would hide exactly that.
    const corte = corteFrom([took("ana@x.dev", 100, "cash")], [handedBack("beto@x.dev", 60, "cash")]);
    const beto = corte.people.find(p => p.actor === "beto@x.dev")!;
    expect(beto).toBeDefined();
    expect(beto.cash).toBe(-60);
    expect(beto.count).toBe(0);
    expect(corte.totals.cash).toBe(40);
  });

  it("ignores a refund line it cannot read rather than guessing", () => {
    const corte = corteFrom(
      [took("ana@x.dev", 100, "cash")],
      [{ action: "refunded", detail: "order=abc12345" }],
    );
    expect(corte.people[0].cash).toBe(100);
    expect(corte.refunded).toBe(0);
  });
});
