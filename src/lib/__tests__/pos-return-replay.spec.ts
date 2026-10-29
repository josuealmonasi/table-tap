import { beforeEach, expect, it, vi } from "vitest";
import { returnFixture, ORDER } from "./returns-contract-fixtures";
import { existingTicket } from "@/lib/pos-sale";
import { dropHeld, holdSale, readHeld, saleAcknowledgement, type HeldSale } from "@/lib/offline-sales";
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
const sale: HeldSale = { posRef: ORDER, restaurantId: "r1", currency: "MXN", at: "2026-10-28T12:00:00Z",
  method: "cash", items: [], charge: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 } };
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k),
    key: (i: number) => [...store.keys()][i] ?? null, get length() { return store.size; } });
});
it.each([60, 0])("an offline sale replay after a return (retained %s) leaves the device for its original collection", async retained => {
  const f = returnFixture();
  Object.assign(f.tables.orders[0], { pos_ref: ORDER, pay_method: "cash", total: retained });
  f.rpc.mockResolvedValue({ data: { outcome: "settled", settled: true, repeat: true, orderId: ORDER,
    total: 100, currency: "MXN", method: "cash", handedOver: true }, error: null });
  expect(holdSale(sale)).toBe(true);
  const response = await existingTicket(f as never, ORDER, "r1", { currency: "MXN", method: "cash" });
  const ticket = await response?.json();
  expect(saleAcknowledgement(sale, ticket)).toBe("settled");
  expect(ticket.total).toBe(100);
  expect(f.rpc).toHaveBeenCalledWith("pos_ticket", { p_restaurant: "r1", p_ref: ORDER });
  expect(dropHeld(ORDER, "r1")).toBe(true);
  expect(readHeld()).toEqual([]);
});
it("a contradictory original collection still stays on the device", () => {
  expect(saleAcknowledgement(sale, { settled: true, orderId: ORDER, total: 60, currency: "MXN", method: "cash" })).toBe("mismatch");
});
it("keeps the device's sale when the original ticket cannot be read", async () => {
  const f = returnFixture();
  Object.assign(f.tables.orders[0], { pos_ref: ORDER, pay_method: "cash", total: 0 });
  f.rpc.mockResolvedValue({ data: null, error: null });
  holdSale(sale);
  const response = await existingTicket(f as never, ORDER, "r1");
  expect(response?.status).toBe(503);
  expect(saleAcknowledgement(sale, await response?.json())).toBe("unsettled");
  expect(readHeld()).toHaveLength(1);
});
