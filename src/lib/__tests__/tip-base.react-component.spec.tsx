import { expect, it } from "vitest";
import { frozenTipPrincipal, ordersTipBase, splitTipBase, tipFromPercent } from "@/lib/tip-base";

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
it("never lets a negative discount raise the base", () => {
  expect(ordersTipBase([{ total: 100 }], -20)).toBe(100);
});
