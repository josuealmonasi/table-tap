// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import SettleTableDialog from "../SettleTableDialog";
import TableCalculator from "../TableCalculator";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
let root: Root, host: HTMLDivElement;
const order = { id: "order", session_id: "session", total: 100, subtotal: 100, collected: 0, currency: "MXN", paid: false, status: "received", items: [] };
const t = (key: string) => translate(messagesFor("es"), key);
const checkbox = () => [...host.querySelectorAll("label")].find(l => l.textContent === t("cardEmail.skip"))?.querySelector<HTMLInputElement>("input");
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ amount: 100, tip: 0, currency: "MXN", settled: true });
    if (String(url).startsWith("/api/loyalty/attach")) return Response.json({ enabled: true, card: { email: "j***@hotmail.com" } });
    return Response.json({ orders: [order], splits: [], outstanding: { owed: 100, ordered: 100, collected: 0, tips: 0, currency: "MXN" } });
  }));
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(screen: React.ReactNode) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{screen}</SWRConfig>));
}
it.each(["table", "counter", "part"])("shows the card address and passes the skip choice to %s collection", async kind => {
  await render(kind === "part" ? <TableCalculator open tableId="table" tableLabel="1" currency="MXN" onCollected={vi.fn()} onClose={vi.fn()} />
    : <SettleTableDialog open tableId={kind === "table" ? "table" : null} orderId="order" restaurantId="r" tableLabel="1" currency="MXN" canApprove={false} onSettled={vi.fn()} onClose={vi.fn()} />);
  expect(host.textContent).toContain("El ticket se enviará a j***@hotmail.com"); expect(checkbox()).toBeTruthy();
  await act(async () => checkbox()!.click());
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t("settle.cash")))!.click());
  const call = vi.mocked(fetch).mock.calls.find(([, init]) => init?.method === "POST")!;
  expect(call[0]).toBe(kind === "part" ? "/api/table-payment/part" : "/api/table-payment");
  expect(JSON.parse(call[1]!.body as string).skipTicketEmail).toBe(true);
});
it("a failed email read still allows a collection and a deliberate skip", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((url, init) => String(url).startsWith("/api/loyalty/attach") ? Promise.resolve(Response.json({}, { status: 503 })) : original(url, init));
  await render(<TableCalculator open tableId="table" tableLabel="1" currency="MXN" onCollected={vi.fn()} onClose={vi.fn()} />);
  expect(checkbox()).toBeTruthy();
  await act(async () => checkbox()!.click());
  const cash = [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t("settle.cash")))!;
  expect(cash.disabled).toBe(false); await act(async () => cash.click());
  expect(vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
});
it("the part calculator preserves the skip chosen on the collection sheet", async () => {
  await render(<SettleTableDialog open tableId="table" restaurantId="r" tableLabel="1" currency="MXN" canApprove={false} onSettled={vi.fn()} onClose={vi.fn()} />);
  await act(async () => checkbox()!.click());
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === t("settle.parts"))!.click());
  expect(checkbox()!.checked).toBe(true);
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t("settle.cash")))!.click());
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/table-payment/part")!;
  expect(JSON.parse(call[1]!.body as string).skipTicketEmail).toBe(true);
});
it("a part-payment retry keeps the reviewed email choice after a lost reply", async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  let writes = 0;
  vi.mocked(fetch).mockImplementation((url, init) => url === "/api/table-payment/part" && writes++ === 0 ? Promise.reject(new Error("lost reply")) : original(url, init));
  await render(<TableCalculator open tableId="table" tableLabel="1" currency="MXN" onCollected={vi.fn()} onClose={vi.fn()} />);
  await act(async () => checkbox()!.click());
  const cash = () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t("settle.cash")))!;
  await act(async () => cash().click());
  expect(checkbox()!.disabled).toBe(true);
  await act(async () => cash().click());
  const calls = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/table-payment/part");
  expect(calls).toHaveLength(2); expect(calls[1][1]!.body).toBe(calls[0][1]!.body);
});
