import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Security sweep 2026-11-24: a suspended restaurant rings no sale on the device's word. */
it("offline intake queues for review while suspended, and never rings directly", () => {
  const intake = readFileSync("src/lib/offline-intake.ts", "utf8");
  expect(intake).toContain('select("suspended_at")');
  expect(intake).toContain("!blocked && !suspended && offlineCharge(body.offline)");
  expect(intake).toContain('else if (suspended) reason = "apiErr.restaurantSuspended";');
  // An unreadable restaurant counts as suspended: nothing is rung.
  expect(intake).toContain("Boolean(stateError || !state || state.suspended_at)");
});

it("the till trusts a pre-suspension date only with the server's own queue row", () => {
  const helper = readFileSync("src/lib/restaurant-suspension.ts", "utf8");
  expect(helper).toContain("if (queuedBefore && new Date(collectedAt).getTime() < new Date(String(suspendedAt)).getTime()) return null;");
  expect(readFileSync("src/app/api/pos/order/route.ts", "utf8")).toContain("queuedBeforeSuspension(db, actor.restaurantId, posRef, restaurant.suspended_at)");
});
