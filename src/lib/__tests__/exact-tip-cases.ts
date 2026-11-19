/**
 * One table of splits for the "exact tip only" rule, read by both the pay
 * route's spec and the screen's spec: the route refuses a percentage exactly
 * when the screen shows the exact-amount field instead of percentages.
 */
export const EXACT_TIP_CASES = [
  { name: "old gross split", food_principal: null, amount: 120, exactOnly: true },
  { name: "old split frozen at zero", food_principal: null, amount: 0, exactOnly: false },
  { name: "old split with no amount", food_principal: null, amount: null, exactOnly: false },
  { name: "trusted principal", food_principal: 100, amount: 120, exactOnly: false },
  { name: "trusted zero principal", food_principal: 0, amount: 20, exactOnly: false },
] as const;

export const EXACT_TIP_ORDERS = [{ total: 120, tip: 20 }];
