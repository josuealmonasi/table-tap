import { expect, it } from "vitest";
import { frozenTipPrincipal, ordersTipBase, splitTipBase, splitTipPrincipal, tipFromPercent } from "@/lib/tip-base";

it("excludes service, earlier tips, discounts already in total, and only collected principal", () => {
  const orders = [{ total: 120, service_fee: 10, tip: 10, collected: 35, collected_tip: 5 }];
  // MX$110 of food and service, MX$30 of it paid: the paid part was food and
  // service in proportion, so MX$100 × 80/110 of food is still owed.
  expect(ordersTipBase(orders)).toBe(72.73);
  expect(ordersTipBase(orders, 20)).toBe(52.73);
  expect(tipFromPercent(ordersTipBase(orders, 20), 15)).toBe(7.91);
  expect(ordersTipBase([...orders, { total: 5, service_fee: 10, tip: 0 }], 100)).toBe(0);
});
it("freezes split food, allocates remainder once, and adds only the diner's later food", () => {
  const frozen = [{ total: 130.01, service_fee: 10, tip: 20 }];
  const principal = frozenTipPrincipal(110.01, frozen);
  expect(principal).toBe(100.01);
  expect([0, 1, 2].map(n => splitTipBase(principal, 3, [n]))).toEqual([33.35, 33.33, 33.33]);
  expect(splitTipBase(principal, 3, [0, 2], ordersTipBase([{ total: 25, service_fee: 2, tip: 3 }]))).toBe(86.68);
  expect(frozenTipPrincipal(null, frozen)).toBe(100.01);
});
it.each([[10, -1, 0], [10, 500, 10], [10, NaN, 0], [10, Infinity, 0], [NaN, 10, 0], [-1, 10, 0], [2.67, 15, 0.4]])(
  "bounds and rounds percentage tips (%s, %s)", (base, pct, expected) => expect(tipFromPercent(base, pct)).toBe(expected));
it("leaves only the food share of a partial payment out of the base", () => {
  // MX$100 food + MX$10 service, half paid: MX$50 of food is still owed.
  expect(ordersTipBase([{ total: 110, service_fee: 10, collected: 55 }])).toBe(50);
  // A tip already collected never counts as food paid.
  expect(ordersTipBase([{ total: 115, service_fee: 10, tip: 5, collected: 60, collected_tip: 5 }])).toBe(50);
  expect(ordersTipBase([{ total: 110, service_fee: 10, collected: 110 }])).toBe(0);
});
it("tips only the food share of a split frozen after part of the bill was collected", () => {
  // MX$100 food + MX$10 service, MX$55 collected before the table split: the
  // frozen principal is MX$55 of food and service, MX$50 of it food.
  const frozen = [{ total: 110, service_fee: 10, collected: 55 }];
  expect(frozenTipPrincipal(55, frozen)).toBe(50);
  expect([0, 1].map(n => tipFromPercent(splitTipBase(50, 2, [n]), 10))).toEqual([2.5, 2.5]);
});
it("freezes the food still owed on each order after an uneven collection", () => {
  const orders = [{ total: 100, collected: 55 }, { total: 120, service_fee: 20 }];
  const foodTipPrincipal = ordersTipBase(orders);
  expect(foodTipPrincipal).toBe(145);
  const principal = splitTipPrincipal({ food_principal: 165, food_tip_principal: foodTipPrincipal }, orders)!;
  expect(principal).toBe(145);
  const bases = [0, 1].map(share => splitTipBase(principal, 2, [share]));
  expect(bases).toEqual([72.50, 72.50]);
  expect(bases.map(base => tipFromPercent(base, 20))).toEqual([14.50, 14.50]);
});
it("keeps the legacy percentage base when the food-only snapshot is null", () => {
  const orders = [{ total: 100, collected: 55 }, { total: 120, service_fee: 20 }];
  expect(splitTipPrincipal({ food_principal: 165, food_tip_principal: null }, orders)).toBe(150);
});
it("honors a frozen zero food base", () => {
  expect(splitTipPrincipal({ food_principal: 55, food_tip_principal: 0 }, [{ total: 100 }])).toBe(0);
});
it("M4/N14: an old gross split never infers a percentage base from later collections", () => {
  // Two-way split of MX$100 food, locked before food_principal existed: amount froze MX$100.
  const split = { food_principal: null, amount: 100 };
  const before = [{ total: 100 }];
  // Share 0 paid MX$50 + a MX$5 tip, which landed on the order.
  const after = [{ total: 105, tip: 5, collected: 55, collected_tip: 5 }];
  // The original tip breakdown was not frozen. The owner chose exact amounts
  // for these old splits, rather than either shrinking or inflated presets.
  expect(splitTipPrincipal(split, before)).toBeNull();
  expect(splitTipPrincipal(split, after)).toBeNull();
  // What the orders still owe was the old base, divided by the shares again.
  expect(tipFromPercent(splitTipBase(frozenTipPrincipal(null, after), 2, [1]), 10)).toBe(2.5);
  // A frozen principal still wins, and a split never locked reads the orders.
  expect(splitTipPrincipal({ food_principal: 80, amount: 100 }, before)).toBe(80);
  expect(splitTipPrincipal({ food_principal: null, amount: 0 }, before)).toBe(100);
});
it("never lets a negative discount raise the base", () => {
  expect(ordersTipBase([{ total: 100 }], -20)).toBe(100);
});
