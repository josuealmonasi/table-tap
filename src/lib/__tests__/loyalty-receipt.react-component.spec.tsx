import { expect, it, vi } from "vitest";
import { buildReceipt, type ReceiptOrder } from "@/lib/receipt";
import { offlineReceipt } from "@/lib/offline-receipt";
import { standing } from "@/lib/loyalty/standing";
import { messagesFor, translate } from "@/lib/i18n";
import { loyaltyReceiptLines } from "@/lib/loyalty/receipt";
const f = vi.hoisted(() => ({ card: vi.fn() }));
vi.mock("@/lib/loyalty/attachment-server", () => ({ receiptCard: f.card }));
import { withReceiptCards } from "@/lib/loyalty/receipt-source";
const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);
const place = { name: "Bistro", timeZone: "America/Mexico_City", locale: "es-MX" };
const ladder = [{ visits: 4, reward: "Coffee" }, { visits: 8, reward: "Dessert" }];
const card = (progress = 5, done = [4]) => ({ suffix: "K7P2", progress, goal: 8, standing: standing(progress, ladder.map(step => ({ ...step })), done) });
const order: ReceiptOrder = { id: "order", items: [], subtotal: 10, total: 10, currency: "MXN", created_at: "2026-11-11T12:00:00Z" };
it("shows confirmed progress toward the next unredeemed reward on paper and email", () => {
  const receipt = buildReceipt([{ ...order, loyalty: card() }], place, t);
  for (const text of [receipt.text.replaceAll("\n", " "), receipt.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")]) {
    expect(text).toContain("Tarjeta de visitas ···· K7P2: 5 de 8"); expect(text).toContain("te faltan 3 para Dessert"); expect(text).not.toContain("Coffee");
  }
});
it("names an earned reward and the next-visit handover", () => {
  const text = buildReceipt([{ ...order, loyalty: card(4, []) }], place, t).text.replaceAll("\n", " ");
  expect(text).toContain("¡Ganaste Coffee! Pídelo en tu próxima visita."); expect(text).not.toContain("te faltan");
});
it("prints no loyalty line for a sale without a card", () => {
  const receipt = buildReceipt([order], place, t); expect(receipt.text).not.toContain("Tarjeta"); expect(receipt.html).not.toContain("Tarjeta");
});
it("masks even a mistakenly supplied full code and wraps every paper line at 48 columns", () => {
  const lines = loyaltyReceiptLines([{ loyalty: { ...card(), suffix: "K7QM3XW9K7P2" } }], t);
  expect(lines.join(" ")).not.toContain("K7QM3XW9"); expect(lines.join(" ")).toContain("K7P2");
  expect(lines.every(line => Array.from(line).length <= 48)).toBe(true);
});
it("escapes a reward's HTML", () => {
  const loyalty = card(); loyalty.standing.next!.reward = "<script>bad</script>";
  const receipt = buildReceipt([{ ...order, loyalty }], place, t); expect(receipt.html).not.toContain("<script>"); expect(receipt.html).toContain("&lt;script&gt;");
});
it("prints one line group when several paid orders carry the same card", () => {
  const text = buildReceipt([{ ...order, loyalty: card() }, { ...order, id: "other", loyalty: card() }], place, t).text;
  expect(text.match(/Tarjeta de visitas/g)).toHaveLength(1);
});
it("split payment receipts carry their sitting's card too", () => {
  const receipt = buildReceipt([], place, t, { id: "payment", amount: 10, tip: 0, currency: "MXN", created_at: order.created_at, slots: [0], loyalty: card() });
  expect(receipt.text).toContain("K7P2");
});
it("offline paper promises confirmation on reconnection instead of inventing a stamp", () => {
  const html = offlineReceipt({ posRef: "order", at: order.created_at, lines: [], method: "cash", currency: "MXN", loyaltyCode: "K7QM3XW9K7P2",
    charge: { subtotal: 10, serviceFee: 0, tip: 0, discount: 0, total: 10 } }, place, t);
  expect(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).toContain("tu visita se confirmará"); expect(html).not.toContain("K7QM");
});
it("English receipts have the same progress", () => {
  const text = buildReceipt([{ ...order, loyalty: card() }], place, (k, v) => translate(messagesFor("en"), k, v)).text.replaceAll("\n", " ");
  expect(text).toContain("5 of 8 · 3 more for Dessert");
});
it("names the card payment fixed on each paid order, never the sitting's card now (Codex review of #620)", async () => {
  f.card.mockResolvedValue(card());
  const db = { from: vi.fn() };
  const records = [{ ...order, restaurant_id: "r", paid: true, session_id: "s", loyalty_card_id: "order-card" },
    { ...order, id: "second", restaurant_id: "r", paid: true, session_id: "s" }, { ...order, id: "unpaid", restaurant_id: "r", paid: false, session_id: "s", loyalty_card_id: "x" }];
  const result = await withReceiptCards(db as never, records);
  expect(f.card).toHaveBeenCalledTimes(1);
  expect(f.card).toHaveBeenCalledWith("r", "order-card");
  // No sitting read: a card given to the table's bill after this payment is not this receipt's.
  expect(db.from).not.toHaveBeenCalled();
  expect(result[1].loyalty).toBeUndefined(); expect(result[2].loyalty).toBeUndefined();
});

it("issues the receipt without the card when the card cannot be read (Codex review of #620)", async () => {
  f.card.mockRejectedValue(new Error("Could not read attached loyalty card"));
  const result = await withReceiptCards({ from: vi.fn() } as never,
    [{ ...order, restaurant_id: "r", paid: true, loyalty_card_id: "order-card" }]);
  expect(result[0].loyalty).toBeNull();
  expect(buildReceipt(result, place, t).text).not.toContain("Tarjeta de visitas");
});

it("does not collapse distinct cards with the same printed suffix", () => {
  const text = buildReceipt([{ ...order, loyalty: { ...card(), cardId: "a" } }, { ...order, loyalty: { ...card(), cardId: "b" } }], place, t).text;
  expect(text.match(/Tarjeta de visitas/g)).toHaveLength(2);
});
