import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("react", () => ({ useState: (value: unknown) => [value, vi.fn()] }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/hooks/useReceiptOffer", () => ({ rememberSettling: vi.fn() }));
import { useBillPayment } from "../useBillPayment";
beforeEach(() => { vi.clearAllMocks(); });
it.each(["taken", "paid", "reserved", "below_minimum", "stale", "frozen", "split"])("shows the route's %s sentence without changing its payment", async code => {
  const error = `Translated ${code}`;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ code, error }) }));
  const h = useBillPayment("restaurant", "table", "session");
  await h.paySlots({ splitId: "split", revision: 4, slots: [1, 2], expectedCents: 1101, tipCents: 100 });
  expect(state.toast).toHaveBeenCalledWith(error, "error");
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({
    splitId: "split", revision: 4, slots: [1, 2], expectedCents: 1101, tipCents: 100,
    restaurantId: "restaurant", tableId: "table", sessionId: "session",
  });
  vi.unstubAllGlobals();
});
it("keeps model-1's own-order and tip payment body", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "old refusal" }) }));
  await useBillPayment("restaurant", "table", "session").payShare({ splitId: "old", diner: "member", ownOrderIds: ["later-order"], tipPct: 10 });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ splitId: "old", diner: "member", ownOrderIds: ["later-order"], tipPct: 10,
    restaurantId: "restaurant", tableId: "table", sessionId: "session" });
  vi.unstubAllGlobals();
});
