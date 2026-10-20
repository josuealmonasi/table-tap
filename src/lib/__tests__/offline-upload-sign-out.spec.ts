import { beforeEach, expect, it, vi } from "vitest";
import { useOfflineSales } from "@/hooks/useOfflineSales";
import { holdSale, readHeld, type HeldSale } from "@/lib/offline-sales";
import { signOutEverywhere } from "@/lib/sign-out";
const state = vi.hoisted(() => ({ signedOut: vi.fn(), refreshed: vi.fn() }));
vi.mock("react", () => ({ useState: (value: unknown) => [value, vi.fn()], useRef: (value: unknown) => ({ current: value }), useCallback: (fn: unknown) => fn, useEffect: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refreshed }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: async () => { state.signedOut(); return { error: null }; } } }) }));
const sale: HeldSale = { posRef: "held", restaurantId: "r", at: "2026-10-20T12:00:00Z", currency: "MXN", method: "cash", items: [],
  charge: { subtotal: 80, serviceFee: 0, tip: 0, discount: 0, total: 80 } };
beforeEach(() => {
  vi.clearAllMocks();
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key), key: (index: number) => [...store.keys()][index] ?? null, get length() { return store.size; } });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal("window", { location: { assign: vi.fn() } });
  holdSale(sale);
});
it("uploads the exact held receipt and allows sign-out once it is safely queued", async () => {
  const send = vi.fn(async (_url: string, options: RequestInit) => {
    const receipt = JSON.parse(String(options.body));
    return Response.json({ queued: true, orderId: receipt.posRef, receipt });
  });
  vi.stubGlobal("fetch", send);
  await signOutEverywhere();
  expect(state.signedOut).not.toHaveBeenCalled();
  await useOfflineSales("r", true).flush();
  expect(send.mock.calls[0][0]).toBe("/api/pos/upload");
  expect(readHeld()).toEqual([]);
  await signOutEverywhere();
  expect(state.signedOut).toHaveBeenCalledOnce();
});
it("retains a receipt and prevents sign-out after a lost or different queue acknowledgement", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("response lost")).mockResolvedValueOnce(Response.json({ queued: true, orderId: sale.posRef, receipt: { total: 80 } })));
  const offline = useOfflineSales("r", true);
  await offline.flush(); await offline.flush();
  expect(readHeld()).toHaveLength(1);
  await signOutEverywhere();
  expect(state.signedOut).not.toHaveBeenCalled();
});
