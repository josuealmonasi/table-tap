import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMNS,
  LIVE_FLOW,
  backwardOptions,
  columnOrders,
  flowIndex,
} from "@/lib/order-flow";
import type { OrderStatus } from "@/lib/types";

const order = (status: OrderStatus, created_at: string) => ({ status, created_at });

describe("board columns", () => {
  it("mirrors the live flow, in order", () => {
    expect(BOARD_COLUMNS.map(c => c.status)).toEqual(LIVE_FLOW);
  });

  it("leaves completed and cancelled out — they belong in history", () => {
    expect(LIVE_FLOW).not.toContain("completed");
    expect(LIVE_FLOW).not.toContain("cancelled");
  });
});

describe("backwardOptions", () => {
  it("offers nothing from the first column", () => {
    expect(backwardOptions("received")).toEqual([]);
  });

  it("offers only the previous stage from preparing", () => {
    // The user's example: in preparation, the only move is back to new —
    // "ready" is forward, and the main button already does that.
    expect(backwardOptions("preparing")).toEqual(["received"]);
  });

  it("offers every earlier stage from ready, nearest first", () => {
    expect(backwardOptions("ready")).toEqual(["preparing", "received"]);
  });

  it("never offers a forward move", () => {
    for (const status of LIVE_FLOW) {
      const i = flowIndex(status);
      for (const back of backwardOptions(status)) {
        expect(flowIndex(back)).toBeLessThan(i);
      }
    }
  });

  it("offers nothing for a status outside the flow", () => {
    expect(backwardOptions("completed")).toEqual([]);
    expect(backwardOptions("cancelled")).toEqual([]);
  });
});

describe("columnOrders", () => {
  const orders = [
    order("received", "2026-08-10T12:30:00Z"),
    order("preparing", "2026-08-10T12:00:00Z"),
    order("received", "2026-08-10T12:00:00Z"),
    order("received", "2026-08-10T12:15:00Z"),
  ];

  it("keeps only that column's orders", () => {
    expect(columnOrders(orders, "preparing")).toHaveLength(1);
  });

  it("queues oldest first, so a new ticket joins the bottom", () => {
    expect(columnOrders(orders, "received").map(o => o.created_at)).toEqual([
      "2026-08-10T12:00:00Z",
      "2026-08-10T12:15:00Z",
      "2026-08-10T12:30:00Z",
    ]);
  });

  it("returns nothing for an empty column", () => {
    expect(columnOrders(orders, "ready")).toEqual([]);
  });
});
