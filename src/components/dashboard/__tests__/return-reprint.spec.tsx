// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Order } from "@/lib/types";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/print-window", () => ({ printWhenReady: vi.fn() }));
import OrderDetailDialog from "../OrderDetailDialog";
let host: HTMLDivElement, root: Root;
const order: Order = { id: "one", restaurant_id: "r1", table_id: null, table_label: null, subtotal: 70, tax_pct: 0, note: null,
  pay_method: "cash", stripe_payment_intent: null, stripe_refund_id: null, paid: true, status: "completed", total: 80,
  tip: 10, service_fee: 0, items: [], created_at: "2026-10-28T12:00:00Z", currency: "MXN" };
const bodies: Record<string, unknown>[] = [];
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); bodies.length = 0;
  vi.spyOn(window, "open").mockReturnValue({ document: { write: vi.fn(), close: vi.fn() } } as unknown as Window);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string)); return Response.json({ html: "<p>Receipt</p>", version: { adjustmentIds: [], returnCopy: "signed-financial-copy" } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function print() { await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "orders.printReceipt")!.click()); }
it("keeps the issued financial copy for a staff reprint and starts fresh for a different order", async () => {
  await act(async () => root.render(<OrderDetailDialog order={order} currency="MXN" open onClose={vi.fn()} />));
  await print(); await print();
  expect(bodies[0].version).toBeUndefined();
  expect(bodies[1].version).toEqual({ adjustmentIds: [], returnCopy: "signed-financial-copy" });
  await act(async () => root.render(<OrderDetailDialog order={{ ...order, id: "two" }} currency="MXN" open onClose={vi.fn()} />));
  await print(); expect(bodies[2].version).toBeUndefined();
});
