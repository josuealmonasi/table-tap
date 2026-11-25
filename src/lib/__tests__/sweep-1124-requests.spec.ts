import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Security sweep 2026-11-24, low bundle A: requests a waiter or an old diner could repeat. */
const read = (p: string) => readFileSync(p, "utf8");

it("a waiter's discount and write-off asks reuse the pending one and have a per-person ceiling", () => {
  const guard = read("src/lib/staff-request-guard.ts");
  expect(guard).toContain("isRateLimited(`${kind}:${actorEmail}`, 30, 60)");
  expect(guard).toContain('staffWriteLimited(actorEmail, "staff-request")');
  expect(guard).toContain('.eq("status", "pending")');
  const discount = read("src/app/api/bill/discount/route.ts");
  expect(discount.indexOf("repeatedStaffRequest(")).toBeLessThan(discount.indexOf('from("discount_requests").insert'));
  const writeOff = read("src/app/api/bill/write-off/route.ts");
  expect(writeOff.match(/repeatedStaffRequest\(/g)).toHaveLength(2);
  expect(writeOff.match(/from\("write_off_requests"\)\.insert/g)).toHaveLength(2);
});

it("a table order has a per-person ceiling", () => {
  const route = read("src/app/api/table-order/route.ts");
  expect(route).toContain('staffWriteLimited(actor.email, "table-order")');
});

it("only the current sitting calls for its bill", () => {
  expect(read("src/app/api/service-requests/route.ts")).toContain("if (!member || member.closed) return await apiError(\"apiErr.tableJoin\", 403);");
});
