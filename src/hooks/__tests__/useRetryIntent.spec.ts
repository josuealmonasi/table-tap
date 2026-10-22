import { expect, it, vi } from "vitest";
vi.mock("react", () => ({ useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()] }));
const { useRetryIntent } = await import("@/hooks/useRetryIntent");

it("says nothing is unconfirmed while the first send is still on its way", () => {
  // «Este pedido no se confirmó» over «Guardando…» read as an order that had
  // failed while it was being placed (production, 2026-10-22).
  const attempt = useRetryIntent();
  expect(attempt.unconfirmed(false)).toBe(false);
  attempt.body({ items: ["apple pie"] });
  expect(attempt.unconfirmed(true)).toBe(false);
  // The send ended with no answer: now it is unconfirmed.
  expect(attempt.unconfirmed(false)).toBe(true);
  // And it stays so through the retry, while that send is on its way.
  attempt.body({ items: ["apple pie"] });
  expect(attempt.unconfirmed(true)).toBe(true);
  attempt.clear();
  expect(attempt.unconfirmed(false)).toBe(false);
});
