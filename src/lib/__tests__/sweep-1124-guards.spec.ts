import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/** Security sweep 2026-11-24, low bundle B: guards that must match their siblings. */
const read = (p: string) => readFileSync(p, "utf8");

it("a role change is frozen with a locked subscription, like an invitation", () => {
  const patch = read("src/app/api/staff/route.ts").split("export async function PATCH")[1].split("export async function")[0];
  expect(patch.indexOf("frozenBlocks(actor.restaurantId)")).toBeGreaterThan(-1);
  expect(patch.indexOf("frozenBlocks(")).toBeLessThan(patch.indexOf('.update({ role })'));
});

it("verifying a legacy terminal deposit has the same guard as the deposit routes", () => {
  const verify = read("src/app/api/terminal/deposits/verify/route.ts");
  expect(verify).toContain(`(await frozenBlocks(actor.restaurantId)) ?? (await planBlocks(actor.restaurantId, "pos"))`);
  expect(verify.indexOf("planBlocks(")).toBeLessThan(verify.indexOf('.from("terminal_deposits")'));
});

it("a printer's allowance is its own: counted per restaurant after the token is verified", () => {
  const route = read("src/app/api/print/cloudprnt/[token]/route.ts");
  expect(route).toContain("cloudprnt:printer:${printer.restaurantId}");
  expect(route).not.toMatch(/cloudprnt:\$\{clientKey/);
  expect(route.indexOf("printerForToken(token)")).toBeLessThan(route.indexOf("isRateLimited("));
});
