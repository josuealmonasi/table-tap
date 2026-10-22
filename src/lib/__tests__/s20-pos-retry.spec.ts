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
