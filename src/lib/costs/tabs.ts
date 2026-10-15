export const COSTS_TABS = ["margins", "ingredients", "waste", "stock", "buy"] as const;
export type CostsTab = (typeof COSTS_TABS)[number];
