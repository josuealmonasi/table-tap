import { expect, it } from "vitest";
import { orderChanges, orderReplyTime, reconcileOrders } from "@/components/dashboard/orders-snapshot";
import type { BoardOrder } from "@/lib/kitchen-ticket";

it("never lowers a remembered timestamp", () => {
  const changes = orderChanges();
  changes.remember("a", 4000);
  changes.remember("a", 1000);
  expect(changes.seen.get("a")).toBe(4000);
  changes.remember("a", 5000);
  expect(changes.seen.get("a")).toBe(5000);
});
it("keeps newer realtime evidence after an older HTTP reply finishes", () => {
  const changes = orderChanges();
  const finish = changes.protect("a");
  const base = Date.now() + 10_000;
  changes.remember("a", base + 4000);
  finish(orderReplyTime(new Response(null, { headers: { Date: new Date(base).toUTCString() } })));
  const ready = { id: "a", status: "ready" } as BoardOrder;
  const stale = { id: "a", status: "preparing" } as BoardOrder;
  expect(changes.active.size).toBe(0);
  expect(reconcileOrders([ready], [stale], base + 2000, [], changes)).toEqual([ready]);
  expect(reconcileOrders([ready], [stale], base + 5000, [], changes)).toEqual([stale]);
});
