import { expect, it, vi } from "vitest";
vi.mock("react", () => ({ useRef: (value: unknown) => ({ current: value }), useState: (value: unknown) => [value, vi.fn()] }));
const { useRetryIntent } = await import("@/hooks/useRetryIntent");

it("says nothing is unconfirmed while the first send is still on its way", () => {
  // «Este pedido no se confirmó» over «Guardando…» read as an order that had
  // failed while it was being placed (production, 2026-10-22).
  const attempt = useRetryIntent();
  expect(attempt.unconfirmed()).toBe(false);
  attempt.body({ items: ["apple pie"] });
  expect(attempt.sending()).toBe(true);
  expect(attempt.unconfirmed()).toBe(false);
  // The send ended with no answer: now it is unconfirmed.
  attempt.ended();
  expect(attempt.sending()).toBe(false);
  expect(attempt.unconfirmed()).toBe(true);
  // And it stays so through the retry, while that send is on its way.
  attempt.body({ items: ["apple pie"] });
  expect(attempt.unconfirmed()).toBe(true);
  attempt.ended();
  attempt.clear();
  expect(attempt.unconfirmed()).toBe(false);
});

it("a form reopened mid-send still knows the send is out (cross-review of batch 5)", () => {
  // The request and its sending state live in the parent hook; a remounted
  // form with busy=false used to show the warning before any reply.
  const attempt = useRetryIntent();
  attempt.body({ packs: 1, total: 100 });
  // The form closes and reopens here; nothing it holds is consulted.
  expect(attempt.unconfirmed()).toBe(false);
  expect(attempt.sending()).toBe(true);
});
