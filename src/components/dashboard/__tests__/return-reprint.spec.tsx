// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Order } from "@/lib/types";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => children }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/lib/print-window", () => ({ printWhenReady: vi.fn() }));
import OrderDetailDialog from "../OrderDetailDialog";
let host: HTMLDivElement, root: Root;
const order: Order = { id: "one", restaurant_id: "r1", table_id: null, table_label: null, subtotal: 70, tax_pct: 0, note: null,
  pay_method: "cash", stripe_payment_intent: null, stripe_refund_id: null, paid: true, status: "completed", total: 80,
  tip: 10, service_fee: 0, items: [], created_at: "2026-10-28T12:00:00Z", currency: "MXN" };
const bodies: Record<string, unknown>[] = [];
const popup = { document: { write: vi.fn(), close: vi.fn() }, close: vi.fn(), focus: vi.fn(), closed: false };
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); bodies.length = 0;
  vi.clearAllMocks(); popup.closed = false;
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
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

it("reserves staff receipt paper before the request can consume the click", async () => {
  let answer!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  await act(async () => root.render(<OrderDetailDialog order={order} currency="MXN" open onClose={vi.fn()} />));
  await print();
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(popup.document.write).not.toHaveBeenCalled();
  await act(async () => answer(Response.json({ html: "<p>Receipt</p>" })));
  expect(popup.document.write).toHaveBeenCalledWith(expect.stringContaining("<p>Receipt</p>"));
  expect(popup.close).not.toHaveBeenCalled();
});

it.each(["refused", "lost", "missing HTML"])("closes staff paper with a visible failure when the read is %s", async failure => {
  if (failure === "lost") vi.mocked(fetch).mockRejectedValue(new Error("lost"));
  else vi.mocked(fetch).mockResolvedValue(Response.json(failure === "refused" ? { error: "Try again" } : {}, { status: failure === "refused" ? 503 : 200 }));
  await act(async () => root.render(<OrderDetailDialog order={order} currency="MXN" open onClose={vi.fn()} />));
  await print();
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(popup.close).toHaveBeenCalledTimes(1);
  expect(popup.document.write).not.toHaveBeenCalled();
  expect(toast).toHaveBeenCalledWith(expect.any(String), "error");
  expect([...host.querySelectorAll("button")].every(b => !b.disabled)).toBe(true);
});

it("does not open a browser window for kitchen paper", async () => {
  await act(async () => root.render(<OrderDetailDialog order={order} currency="MXN" open onClose={vi.fn()} />));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "orders.printKitchen")!.click());
  expect(window.open).not.toHaveBeenCalled();
});
