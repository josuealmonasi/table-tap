import { expect, it } from "vitest";
import { arrangeRetry } from "../../../scripts/api-retry-fixture.mjs";
import { retryCases } from "../../../scripts/api-retry-cases.mjs";

it("the POS retry uses the disposable account restaurant", () => {
  const accountFixture = { restaurant: { id: "private" }, menu: { id: "private-menu" } };
  const root = { restaurant: { id: "demo" }, accountFixture };
  const check = retryCases(root).find(item => item.name.startsWith("S20 K3:"));
  expect(check && "fixture" in check ? check.fixture : undefined).toBe(accountFixture);
});

it("the POS retry refuses to borrow the demo when its private fixture is missing", async () => {
  const root = { restaurant: { id: "demo" } };
  const check = retryCases(root).find(item => item.name.startsWith("S20 K3:"));
  await expect(check?.arrange(root)).rejects.toThrow("disposable account restaurant");
});

it("POS retry cleanup leaves retained sources for the restaurant cascade", async () => {
  const deleted: string[] = [];
  const restored: string[] = [];
  const admin = { from: (table: string) => {
    let action = "select";
    const query = {
      select: () => query, eq: () => query, or: () => query, in: () => query, is: () => query,
      insert: () => { action = "insert"; return query; },
      update: () => { action = "update"; restored.push(table); return query; },
      delete: () => { action = "delete"; deleted.push(table); return query; },
      single: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        const error = action === "delete" && table === "orders"
          ? { message: "account_movements_order_id_fkey" } : null;
        const data = table === "orders" ? [{ id: "charged-order", stock_reservation_id: "reservation" }]
          : table === "restaurants" ? { plan: "casa", accepting_orders: true }
          : table === "menus" ? { active: true, schedule: null } : { id: `${table}-id` };
        return Promise.resolve({ data, error }).then(resolve);
      },
    };
    return query;
  } };
  const fixture = { admin, restaurant: { id: "private" }, menu: { id: "private-menu" } };
  const undo = await arrangeRetry(fixture, {}, "pos");
  await expect(undo()).resolves.toBeUndefined();
  expect(deleted).toEqual([]);
  expect(restored.slice(-2)).toEqual(["menus", "restaurants"]);
});
