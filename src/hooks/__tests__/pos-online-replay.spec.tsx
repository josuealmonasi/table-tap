// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { usePosCharge } from "../usePosCharge";
import { useOfflineSales } from "../useOfflineSales";
import { readHeld, replayBody } from "@/lib/offline-sales";
const state = vi.hoisted(() => ({ router: { refresh: vi.fn() }, t: (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => state.t, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/pos-last-sale", () => ({ rememberLastSale: vi.fn() }));
let offline: ReturnType<typeof useOfflineSales>, till: ReturnType<typeof usePosCharge>, root: Root;
function Harness() {
  offline = useOfflineSales("r");
  till = usePosCharge({ collector: "cashier", collectorContext: "signed", restaurant: { id: "r", name: "Cafe", currency: "MXN" },
    cart: { lines: [{ itemId: "dish", name: "Soup", emoji: "", mods: {}, price: 100, qty: 1 }], clear: vi.fn() },
    details: { tipPct: 0, tipCustom: null, noTicket: true, customerName: "", note: "", email: "", terminalRef: "", reset: vi.fn() },
    offline, canEmailReceipt: false, pricing: { subtotal: 100, serviceFee: 0, tip: 0, discount: 0, total: 100, lines: [{ itemId: "dish", qty: 1, gross: 100, unit: 100 }], promoSavings: {} },
  } as unknown as Parameters<typeof usePosCharge>[0]);
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("navigator", { onLine: true }); localStorage.clear();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("C5: background replay skips a sale while its original online request is in flight", async () => {
  let answer!: (res: Response) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }))
    .mockResolvedValue(Response.json({ error: "held" }, { status: 503 }));
  let pending!: Promise<void>;
  await act(async () => { pending = till.charge("cash"); });
  await act(async () => offline.flush());
  const overlapping = vi.mocked(fetch).mock.calls.length;
  await act(async () => { answer(Response.json({ error: "held", held: true }, { status: 503 })); await pending; });
  expect(overlapping).toBe(1);
  await act(async () => offline.flush());
  expect(fetch).toHaveBeenCalledTimes(2);
});
it("C5: an interrupted kitchen submission keeps its preparation pending on replay", async () => {
  await act(async () => till.charge("cash"));
  expect(replayBody(readHeld()[0])).toMatchObject({ offline: { preparationPending: true } });
});
it("C5: a sale taken entirely offline keeps its fulfilled preparation on replay", async () => {
  vi.stubGlobal("navigator", { onLine: false });
  await act(async () => till.charge("cash"));
  expect(replayBody(readHeld()[0])).toMatchObject({ offline: { preparationPending: false } });
});
it("C5: the SQL writer does not finish interrupted kitchen preparation", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8").split("create or replace function public.record_offline_sale(")[1].split("$$;")[0];
  expect(sql).toContain("p_order->>'preparation_pending'");
  expect(sql).toContain("then 'received' else 'completed' end");
});

it("C5: the money writer preserves the requested kitchen stage even with an offline timestamp", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8").split("create or replace function public.ring_pos_sale_v2(")[1].split("$$;")[0];
  expect(sql).toMatch(/settle_offline_sale_v2[\s\S]*?update orders set status = p_status[\s\S]*?where id = p_ref and restaurant_id = p_restaurant/);
  expect(sql).toContain("'handedOver', p_status = 'completed'");
});
