import { expect, it } from "vitest";
import { returnTips } from "@/lib/admin-usage-returns";

it("allocates partial return tips cumulatively, including earlier pieces", () => {
  const tips = returnTips([{ id: "op", amount: 10, tip: 1 }], [
    { id: "a", operation_id: "op", amount_cents: 333, succeeded_at: "2026-10-01T00:00:00Z" },
    { id: "b", operation_id: "op", amount_cents: 667, succeeded_at: "2026-11-01T00:00:00Z" },
  ]);
  expect(tips.get("a")).toBe(33);
  expect(tips.get("b")).toBe(67);
});

it("rejects return pieces exceeding the saved operation", () => {
  expect(() => returnTips([{ id: "op", amount: 10, tip: 1 }], [
    { id: "a", operation_id: "op", amount_cents: 1001, succeeded_at: "2026-11-01T00:00:00Z" },
  ])).toThrow();
});
