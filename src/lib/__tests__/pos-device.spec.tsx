import { beforeEach, expect, it, vi } from "vitest";
import type { HeldSale } from "@/lib/offline-sales";

const state = vi.hoisted(() => ({ storage: new Map<string, string>(), fetch: vi.fn(), toast: vi.fn(), clear: vi.fn() }));
vi.mock("react", () => ({
  useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }),
  useCallback: (fn: unknown) => fn, useEffect: () => {},
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: () => {} }));
const { usePosCharge } = await import("@/hooks/usePosCharge");
const { useOfflineSales } = await import("@/hooks/useOfflineSales");
const { holdSale, readHeld, replayBody } = await import("@/lib/offline-sales");
const sale: HeldSale = { posRef: "6b1f0c2e-0000-4000-8000-000000000001", restaurantId: "r", at: new Date().toISOString(), method: "cash", items: [], charge: { subtotal: 100, total: 100, discount: 0, tip: 0, serviceFee: 0 } };
function useTill() {
  const offline = useOfflineSales("r");
  return usePosCharge({ collectorContext: "signed-context", collector: "cashier@x.dev", restaurant: { id: "r", currency: "MXN" }, cart: { lines: [{ itemId: "x", price: 100, qty: 1 }], clear: state.clear }, details: { tipPct: 0, tipCustom: null, noTicket: true, customerName: "", note: "", terminalRef: "", reset: vi.fn() }, canEmailReceipt: false, pricing: sale.charge, offline } as unknown as Parameters<typeof usePosCharge>[0]);
}
beforeEach(() => {
  state.storage.clear(); state.fetch.mockReset(); state.toast.mockReset(); state.clear.mockReset();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => state.storage.get(k) ?? null, setItem: (k: string, v: string) => state.storage.set(k, v),
    removeItem: (k: string) => state.storage.delete(k), key: (i: number) => [...state.storage.keys()][i] ?? null,
    get length() { return state.storage.size; },
  });
  vi.stubGlobal("navigator", { onLine: true }); vi.stubGlobal("fetch", state.fetch);
});
it("W1.4 holds the complete sale before the first request starts", async () => {
  let heldAtSend: HeldSale[] = [];
  state.fetch.mockImplementation(async () => { heldAtSend = readHeld(); throw new Error("lost"); });
  await useTill().charge("cash");
  expect(heldAtSend).toHaveLength(1);
  expect(heldAtSend[0]).toMatchObject({ restaurantId: "r", method: "cash", charge: sale.charge });
});
it("W1.2 keeps a repeat that has no settled acknowledgement", async () => {
  holdSale(sale);
  state.fetch.mockResolvedValue(Response.json({ repeat: true, orderId: sale.posRef, total: 100 }));
  await useOfflineSales("r").flush();
  expect(readHeld()).toHaveLength(1);
});
it("W1.5 keeps a differing acknowledgement for reconciliation", async () => {
  holdSale(sale);
  state.fetch.mockResolvedValue(Response.json({ settled: true, orderId: sale.posRef, total: 120 }));
  await useOfflineSales("r").flush();
  expect(readHeld()).toHaveLength(1);
});

it("drops a held sale only after a matching settled ticket", async () => {
  holdSale(sale);
  state.fetch.mockResolvedValue(Response.json({ settled: true, orderId: sale.posRef, total: 100, currency: "MXN", method: "cash" }));
  await useOfflineSales("r").flush();
  expect(readHeld()).toEqual([]);
});
it("keeps the contradictory server ticket durably for a manager", async () => {
  holdSale(sale);
  state.fetch.mockResolvedValue(Response.json({ settled: true, orderId: "other-ticket", total: 120 }));
  await useOfflineSales("r").flush();
  expect(readHeld()[0]).toMatchObject({ acknowledgement: { orderId: "other-ticket", total: 120 }, error: "pos.saleMismatch" });
});
it("never sends collected money if device storage refuses the write", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("full"); }, removeItem: () => {}, key: () => null, length: 0 });
  await useTill().charge("cash");
  expect(state.fetch).not.toHaveBeenCalled();
  expect(state.toast).toHaveBeenCalledWith("pos.offlineNoStorage", "error");
});
it("keeps an unreadable success and moves the cart to its one held sale", async () => {
  state.fetch.mockResolvedValue(new Response("not JSON"));
  await useTill().charge("cash");
  expect(readHeld()).toHaveLength(1);
  expect(state.clear).toHaveBeenCalledTimes(1);
});
it("removes the online sale after its matching settled acknowledgement", async () => {
  state.fetch.mockImplementation(async (_url, options) => {
    const request = JSON.parse(options.body);
    expect(readHeld()[0].posRef).toBe(request.posRef);
    expect(request.collected).toEqual({ at: readHeld()[0].at, ...sale.charge });
    return Response.json({ orderId: request.posRef, code: "ORD-TEST", total: 100, settled: true, currency: "MXN", method: "cash" });
  });
  await useTill().charge("cash");
  expect(readHeld()).toEqual([]);
});
it("an offline account charge is never turned into a held cash sale", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await useTill().charge("account");
  expect(readHeld()).toEqual([]);
  expect(state.fetch).not.toHaveBeenCalled();
});

it("later unreadable replies do not erase a contradictory server ticket", async () => {
  holdSale(sale);
  state.fetch.mockResolvedValueOnce(Response.json({ settled: true, orderId: "other-ticket", total: 120 }))
    .mockResolvedValueOnce(new Response("not JSON"));
  const offline = useOfflineSales("r");
  await offline.flush();
  await offline.flush();
  expect(readHeld()[0].acknowledgement).toEqual({ orderId: "other-ticket", total: 120 });
});

it("a refused sale leaves nothing held and keeps the cart", async () => {
  state.fetch.mockResolvedValue(Response.json({ error: "closed", code: "outOfStock", short: [] }, { status: 409 }));
  await useTill().charge("cash");
  expect(readHeld()).toEqual([]);
  expect(state.clear).not.toHaveBeenCalled();
});
it("a refusal that says the money is in the drawer keeps the sale held", async () => {
  state.fetch.mockResolvedValue(Response.json({ error: "mismatch", held: true }, { status: 409 }));
  await useTill().charge("cash");
  expect(readHeld()).toHaveLength(1);
  expect(state.clear).toHaveBeenCalledTimes(1);
});
it("a server error keeps the sale held", async () => {
  state.fetch.mockResolvedValue(Response.json({ error: "boom" }, { status: 500 }));
  await useTill().charge("cash");
  expect(readHeld()).toHaveLength(1);
});

it("lets the device go only after the server received every field of the queued receipt", async () => {
  holdSale(sale);
  state.fetch.mockResolvedValueOnce(Response.json({ queued: true, orderId: sale.posRef, receipt: { ...replayBody(sale), method: "card" } }))
    .mockResolvedValueOnce(Response.json({ queued: true, orderId: sale.posRef, receipt: replayBody(sale) }));
  const offline = useOfflineSales("r");
  await offline.flush();
  expect(readHeld()).toHaveLength(1);
  await offline.flush();
  expect(readHeld()).toEqual([]);
});
it("keeps queued money on the device when the queue write response is lost", async () => {
  holdSale(sale);
  state.fetch.mockRejectedValueOnce(new Error("response lost"));
  await useOfflineSales("r").flush();
  expect(readHeld()).toHaveLength(1);
});
