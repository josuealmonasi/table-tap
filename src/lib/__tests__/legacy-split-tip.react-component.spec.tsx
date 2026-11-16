import { expect, it } from "vitest";
import { splitTipPrincipal } from "@/lib/tip-base";

it.each([
  { orders: [{ total: 120, tip: 20 }] },
  { orders: [{ total: 125, tip: 25, collected: 65, collected_tip: 15 }] },
  { orders: [{ total: 110, service_fee: 10, collected: 55 }] },
])("does not infer a frozen tip principal from an old split's gross amount: %j", ({ orders }) => {
  expect(splitTipPrincipal({ food_principal: null, amount: 120 }, orders)).toBeNull();
});

it("keeps trusted frozen principal stable after another diner adds a tip", () => {
  const split = { food_principal: 100, amount: 120 };
  expect(splitTipPrincipal(split, [{ total: 120, tip: 20 }])).toBe(100);
  expect(splitTipPrincipal(split, [{ total: 125, tip: 25 }])).toBe(100);
});

it("distinguishes a trusted zero principal from a missing snapshot", () => {
  expect(splitTipPrincipal({ food_principal: 0, amount: 20 }, [{ total: 20, tip: 20 }])).toBe(0);
  expect(splitTipPrincipal({ food_principal: null, amount: 0 }, [{ total: 120, tip: 20 }])).toBe(100);
});
