import { describe, expect, it } from "vitest";
import type { PromotionWithItems } from "@/lib/promotions";
import type { MenuItem } from "@/lib/types";
import { promotionItemNames } from "@/lib/promotion-names";

const products = [
  { id: "agua", name: "Agua" },
  { id: "taco", name: "Taco" },
] as MenuItem[];
const deal = (items: { item_id: string; qty: number }[]) => ({ items }) as unknown as PromotionWithItems;

describe("a promotion's dishes, as one line", () => {
  it("names each dish with its own quantity", () => {
    expect(promotionItemNames(deal([{ item_id: "taco", qty: 3 }, { item_id: "agua", qty: 1 }]), products)).toBe(
      "3× Taco + Agua",
    );
  });

  it("keeps every quantity on its own dish when one of them has been deleted", () => {
    const line = promotionItemNames(
      deal([
        { item_id: "gone", qty: 1 },
        { item_id: "taco", qty: 3 },
        { item_id: "agua", qty: 1 },
      ]),
      products,
    );
    // Read by position, the deleted dish's 1 landed on the taco: "Taco + Agua".
    expect(line).toBe("3× Taco + Agua");
  });
});
