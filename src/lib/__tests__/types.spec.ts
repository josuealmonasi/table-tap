import { describe, it, expect } from "vitest";
import { lineUnitPrice, orderCode } from "@/lib/types";

describe("lineUnitPrice", () => {
  it("is the base price when there are no extras", () => {
    expect(lineUnitPrice({ price: 10 })).toBe(10);
  });

  it("adds every extra's price", () => {
    const price = lineUnitPrice({
      price: 10,
      extras: [
        { id: "a", name: "Cheese", emoji: "🧀", price: 1.5 },
        { id: "b", name: "Bacon", emoji: "🥓", price: 0.5 },
      ],
    });
    expect(price).toBe(12);
  });
});

describe("orderCode", () => {
  it("builds an ORD-XXXX code from a uuid", () => {
    expect(orderCode("175425bc-a6eb-4645-ae4f-47a13dbbdc49")).toBe("ORD-1754");
    expect(orderCode("abcd1234-0000-0000-0000-000000000000")).toBe("ORD-ABCD");
  });
});
