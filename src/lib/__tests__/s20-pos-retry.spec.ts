import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fetch: vi.fn(), clear: vi.fn() }));
vi.mock("react", () => ({ useState: (v: unknown) => [v, vi.fn()], useRef: (v: unknown) => ({ current: v }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (k: string) => k, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));
const { usePosCharge } = await import("@/hooks/usePosCharge");
beforeEach(() => { state.fetch.mockReset(); vi.stubGlobal("fetch", state.fetch); vi.stubGlobal("navigator", { onLine: true }); });
it("K3 reuses the frozen account request after an unknown response", async () => {
  const lines = [{ itemId: "dish", price: 100, qty: 1 }];
  const input = { restaurant: { id: "r", currency: "MXN" }, collector: "cashier", collectorContext: "signed",
    cart: { lines, clear: state.clear }, details: { tipPct: 0, tipCustom: null, noTicket: true, customerName: "Ana", note: "", reset: vi.fn() },
    pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 }, canEmailReceipt: false,
    offline: { hold: vi.fn(), acknowledge: vi.fn(), discard: vi.fn(), setOnline: vi.fn() } };
  const till = usePosCharge(input as unknown as Parameters<typeof usePosCharge>[0]);
  state.fetch.mockRejectedValueOnce(new Error("reply lost")).mockResolvedValueOnce(Response.json({ error: "busy" }, { status: 503 }));
  await till.charge("account", { id: "account-a" } as Parameters<typeof till.charge>[1]);
  lines[0].qty = 2; input.details.customerName = "Changed";
  await till.charge("account", { id: "account-b" } as Parameters<typeof till.charge>[1]);
  expect(JSON.parse(state.fetch.mock.calls[1][1].body)).toEqual(JSON.parse(state.fetch.mock.calls[0][1].body));
});
function till() {
  const lines = [{ itemId: "dish", price: 100, qty: 1 }];
  const input = { restaurant: { id: "r", currency: "MXN" }, collector: "cashier", collectorContext: "signed",
    cart: { lines, clear: state.clear }, details: { tipPct: 0, tipCustom: null, noTicket: true, customerName: "Ana", note: "", reset: vi.fn() },
    pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100 }, canEmailReceipt: false,
    offline: { hold: vi.fn(), acknowledge: vi.fn(), discard: vi.fn(), setOnline: vi.fn() } };
  return usePosCharge(input as unknown as Parameters<typeof usePosCharge>[0]);
}
const account = { id: "account-a", name: "Ana" } as Parameters<ReturnType<typeof till>["charge"]>[1];
it("batch 5 cross-review 1: an account sale refused on its first send goes back to the till", async () => {
  // A dish taken off the menu on the first try: no other request carried it.
  const pos = till();
  state.fetch.mockResolvedValueOnce(Response.json({ error: "gone" }, { status: 409 }))
    .mockResolvedValueOnce(Response.json({ error: "gone" }, { status: 409 }));
  await pos.charge("account", account);
  await pos.charge("account", account);
  // Let go: the next sale is a new request with its own reference.
  expect(JSON.parse(state.fetch.mock.calls[1][1].body).posRef).not.toBe(JSON.parse(state.fetch.mock.calls[0][1].body).posRef);
});
it("batch 5 cross-review 1: an unmarked refusal of an account retry keeps the MX$100 request", async () => {
  const pos = till();
  state.fetch.mockRejectedValueOnce(new Error("reply lost")).mockResolvedValueOnce(Response.json({ error: "paused" }, { status: 409 }));
  await pos.charge("account", account);
  await pos.charge("account", account);
  expect(state.fetch).toHaveBeenCalledTimes(2);
  expect(JSON.parse(state.fetch.mock.calls[1][1].body).posRef).toBe(JSON.parse(state.fetch.mock.calls[0][1].body).posRef);
  // A third send still carries the same reference: it was not forgotten.
  state.fetch.mockResolvedValueOnce(Response.json({ error: "paused" }, { status: 409 }));
  await pos.charge("account", account);
  expect(JSON.parse(state.fetch.mock.calls[2][1].body).posRef).toBe(JSON.parse(state.fetch.mock.calls[0][1].body).posRef);
});
