import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetOrder,
  recallActiveOrders,
  recallOrders,
  rememberRecentOrder,
} from "@/lib/recent-order";

const R = "rest-1";
const T = "table-9";

/**
 * A localStorage of our own.
 *
 * These tests run in plain Node, on purpose — see vitest.config. The module
 * under test is pure apart from this one browser API, so standing it up by
 * hand is cheaper and more honest than pulling in a DOM to get one Map.
 */
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
});

describe("more than one order on the go", () => {
  it("keeps the first when a second is placed", () => {
    // The bug: ordering a drink after your food lost the way back to the food.
    rememberRecentOrder(R, "food");
    rememberRecentOrder(R, "drink");
    expect(recallActiveOrders(R)).toEqual(["drink", "food"]);
  });

  it("puts the newest first, so the tracker opens on what was just ordered", () => {
    rememberRecentOrder(R, "a");
    rememberRecentOrder(R, "b");
    rememberRecentOrder(R, "c");
    expect(recallActiveOrders(R)[0]).toBe("c");
  });

  it("does not list the same order twice if it is remembered again", () => {
    rememberRecentOrder(R, "a");
    rememberRecentOrder(R, "a");
    expect(recallActiveOrders(R)).toEqual(["a"]);
  });

  it("drops only the order that finished", () => {
    rememberRecentOrder(R, "food");
    rememberRecentOrder(R, "drink");
    forgetOrder(R, null, "food");
    expect(recallActiveOrders(R)).toEqual(["drink"]);
  });

  it("clears the scope when told to forget without naming one", () => {
    rememberRecentOrder(R, "a");
    rememberRecentOrder(R, "b");
    forgetOrder(R, null);
    expect(recallActiveOrders(R)).toEqual([]);
  });
});

describe("a table and a counter do not share their orders", () => {
  it("keeps each scope's list to itself", () => {
    // A phone that ordered at the counter and later sat at a table was offered
    // the counter's order; the same slot backed both.
    rememberRecentOrder(R, "counter");
    rememberRecentOrder(R, "at-table", T);
    expect(recallActiveOrders(R)).toEqual(["counter"]);
    expect(recallActiveOrders(R, T)).toEqual(["at-table"]);
  });

  it("finishing one scope's order leaves the other alone", () => {
    rememberRecentOrder(R, "counter");
    rememberRecentOrder(R, "at-table", T);
    forgetOrder(R, T, "at-table");
    expect(recallActiveOrders(R)).toEqual(["counter"]);
  });
});

describe("a device that ordered before this existed", () => {
  it("still finds its in-flight order from the old single slot", () => {
    // Upgrading mid-meal must not swallow the order they are waiting on.
    localStorage.setItem(`tt-order:${R}`, "from-before");
    expect(recallActiveOrders(R)).toEqual(["from-before"]);
  });
});

describe("what stays rateable", () => {
  it("keeps finished orders in the history", () => {
    rememberRecentOrder(R, "a");
    rememberRecentOrder(R, "b");
    forgetOrder(R, null, "a");
    expect(recallOrders(R)).toContain("a");
  });
});
