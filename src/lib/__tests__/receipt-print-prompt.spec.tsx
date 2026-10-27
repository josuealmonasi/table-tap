// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ ready: vi.fn() }));
vi.mock("@/lib/print-window", () => ({ printWhenReady: state.ready }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? children : null }));
import ReceiptPrompt from "@/components/customer/ReceiptPrompt";
let host: HTMLDivElement, root: Root;
const popup = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), close: vi.fn(), opener: {} };
beforeEach(() => { vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); state.ready.mockClear(); Object.values(popup.document).forEach(fn => fn.mockClear()); popup.close.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function mount() { await act(async () => root.render(<ReceiptPrompt open orderIds={["order"]} onClose={vi.fn()} />)); }
async function print() { await act(async () => { [...host.querySelectorAll("button")].find(b => b.textContent === "receiptPrint.action")!.click(); }); }
it("opens the print window during the click, then prints the server document when ready", async () => {
  const events: string[] = [];
  vi.spyOn(window, "open").mockImplementation(() => { events.push("open"); return popup as unknown as Window; });
  const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => { void _url; void _init; events.push("fetch"); return Response.json({ html: "<html>receipt</html>" }); }); vi.stubGlobal("fetch", fetcher);
  await mount(); await print(); expect(events).toEqual(["open", "fetch"]);
  expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({ orderIds: ["order"], delivery: "print" });
  expect(popup.document.write).toHaveBeenCalledExactlyOnceWith("<html>receipt</html>"); expect(state.ready).toHaveBeenCalledWith(popup);
  expect(host.querySelector('input[type="email"]')).not.toBeNull(); expect(host.textContent).toContain("receiptPrint.hint");
});
it("explains a blocked popup without sending a receipt request", async () => {
  vi.spyOn(window, "open").mockReturnValue(null); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await mount(); await print(); expect(fetcher).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')?.textContent).toContain("receiptPrint.blocked");
});
it("closes a blank popup and leaves email available after a failed receipt read", async () => {
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window); vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  await mount(); await print(); expect(popup.close).toHaveBeenCalledOnce(); expect(state.ready).not.toHaveBeenCalled(); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector('input[type="email"]')).not.toBeNull();
});
