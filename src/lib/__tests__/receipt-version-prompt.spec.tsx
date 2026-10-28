// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/print-window", () => ({ printWhenReady: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => children }));
import ReceiptPrompt from "@/components/customer/ReceiptPrompt";
let host: HTMLDivElement, root: Root;
const popup = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), close: vi.fn(), opener: null, closed: false };
let bodies: Record<string, unknown>[];
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); bodies = [];
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(init.body as string)); return Response.json({ html: "<html>receipt</html>", version: { adjustmentIds: [] } });
  }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function print() {
  await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "receiptPrint.action")!.click(); });
}
it("uses the issued original version for a later print and email in the same prompt", async () => {
  await act(async () => root.render(<ReceiptPrompt open orderIds={["order"]} onClose={vi.fn()} />));
  await print(); await print();
  expect(bodies[0].version).toBeUndefined(); expect(bodies[1].version).toEqual({ adjustmentIds: [] });
  const input = host.querySelector("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "diner@example.com");
    input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(bodies[2]).toEqual({ orderIds: ["order"], email: "diner@example.com", version: { adjustmentIds: [] } });
});
it("sends a slot payment identity instead of substituting the table's orders", async () => {
  await act(async () => root.render(<ReceiptPrompt open paymentId="payment" onClose={vi.fn()} />));
  await print(); expect(bodies[0]).toEqual({ paymentId: "payment", orderIds: [], delivery: "print" });
});
it("does not reuse one bill's issued version for a different bill", async () => {
  await act(async () => root.render(<ReceiptPrompt open orderIds={["first"]} onClose={vi.fn()} />)); await print();
  await act(async () => root.render(<ReceiptPrompt open orderIds={["second"]} onClose={vi.fn()} />)); await print();
  expect(bodies[1].version).toBeUndefined(); expect(bodies[1].orderIds).toEqual(["second"]);
});
