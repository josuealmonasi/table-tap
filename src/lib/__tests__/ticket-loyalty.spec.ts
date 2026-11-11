import { expect, it } from "vitest";
import { ticketLoyalty } from "@/lib/ticket-loyalty";
import { standing } from "@/lib/loyalty/standing";
import type { ReceiptCard } from "@/lib/loyalty/attachment";

const t = (key: string, vars?: Record<string, string | number>) => `${key} ${JSON.stringify(vars ?? {})}`;
const ladder = [{ visits: 8, reward: "Postre gratis" }];
const card = (visits: number): ReceiptCard =>
  ({ cardId: "c1", suffix: "K7P2", progress: visits, goal: 8, standing: standing(visits, ladder, []) });
const order = (loyalty?: ReceiptCard | null) => ({ id: "o", items: [], subtotal: 0, total: 0, created_at: "", loyalty }) as never;

it("prints no card when none was presented", () => {
  expect(ticketLoyalty({ orders: [order()], payment: undefined }, t)).toBeNull();
});

it("prints the sale's card as the payment left it, with the code's last four only", () => {
  const printed = ticketLoyalty({ orders: [order(), order(card(5))], payment: undefined }, t)!;
  expect(printed).toMatchObject({ last4: "K7P2", progress: 5, goal: 8 });
  expect(printed.message).toContain("rewards.toGo");
  expect(printed.message).toContain("Postre gratis");
});

it("prints a split part's card from its sitting (the payment carries it)", () => {
  const payment = { id: "p", amount: 10, currency: "MXN", created_at: "", slots: [0], loyalty: card(8) } as never;
  const printed = ticketLoyalty({ orders: [], payment }, t)!;
  expect(printed.progress).toBe(8);
  expect(printed.message).toContain("rewards.readyHint");
});
