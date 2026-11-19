import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";
import { STATES } from "../../../scripts/promise-cases.mjs";

const source = readFileSync(new URL("../../../scripts/promise-audit.mjs", import.meta.url), "utf8");
const start = source.indexOf("    if (state.splitSlots");
const end = source.indexOf("\n  } finally {\n    await context.close();", start);
const dispatch = source.slice(start, end);
const state = STATES.find(item => item.name === "a table's bill · put it on an account");

async function run(failVisit = false) {
  const cleanup = vi.fn();
  const splitScreenFixture = vi.fn(async () => ({ orderId: "private-order", cleanup }));
  const visits: { path: string; hasAccountChoice: boolean }[] = [];
  const admin = {}, restaurant = { id: "demo" };
  const visit = async (path: string) => {
    // The first Collect belongs to another table's divided bill. That bill
    // correctly offers its remaining parts, rather than a whole-bill account charge.
    visits.push({ path, hasAccountChoice: path.includes("?order=private-order") });
    if (failVisit) throw new Error("browser read failed");
  };
  const work = runInNewContext(`(async () => { ${dispatch} })()`, {
    state, admin, restaurant, splitScreenFixture, visit, ctx: {}, table: { id: "unrelated" },
  });
  return { work, visits, cleanup, splitScreenFixture, admin, restaurant };
}

it("checks the account control on its own unsplit bill when a divided bill comes first", async () => {
  const result = await run();
  await result.work;
  expect(result.visits).toEqual([{ path: "/dashboard/bills?order=private-order", hasAccountChoice: true }]);
  expect(result.splitScreenFixture).toHaveBeenCalledWith(result.admin, result.restaurant.id, false);
  expect(state).not.toHaveProperty("open");
  expect(result.cleanup).toHaveBeenCalledOnce();
});

it("cleans the private bill after a browser failure", async () => {
  const result = await run(true);
  await expect(result.work).rejects.toThrow("browser read failed");
  expect(result.cleanup).toHaveBeenCalledOnce();
});
