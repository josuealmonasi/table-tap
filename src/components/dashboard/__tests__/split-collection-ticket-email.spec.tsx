// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import SettleTableDialog from "../SettleTableDialog";
import TableCalculator from "../TableCalculator";

// A divided bill's part, collected at either staff door, offers the same
// "El ticket se enviará a …" notice and "No enviar esta vez" as a whole bill.
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const t = (key: string) => translate(messagesFor("es"), key);
const order = { id: "order", session_id: "session", total: 100, subtotal: 100, collected: 0, currency: "MXN", paid: false, status: "received", items: [] };
const split = { id: "split", restaurantId: "restaurant", tableId: "table", sessionId: "session", modelVersion: 2, revision: 1,
  status: "locked", currency: "MXN", shares: 2, amount: 100, outstanding: 100, frozen: false, orderIds: ["order"], slots: [
    { shareNo: 0, amountCents: 5000, paid: false, paying: false, feeCents: 0 },
    { shareNo: 1, amountCents: 5000, paid: false, paying: false, feeCents: 0 },
  ] };
let root: Root, host: HTMLDivElement;
const skipBox = () => [...host.querySelectorAll("label")].find(l => l.textContent === t("cardEmail.skip"))?.querySelector<HTMLInputElement>("input");
const slotBox = (n: number) => host.querySelectorAll<HTMLInputElement>("[data-split-slot] input[type=checkbox]")[n];
const cash = () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t("settle.cash")))!;
const collects = () => vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/split/collect").map(([, init]) => JSON.parse(init!.body as string));
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") return Response.json({ ok: true, outcome: "collected", payment: "receipt", amount_cents: 5000, settled: false, owed: 50 });
    if (String(url).startsWith("/api/loyalty/attach")) return Response.json({ enabled: true, card: { email: "j***@hotmail.com" } });
    return Response.json({ orders: [order], splits: [split], outstanding: { owed: 100, ordered: 100, collected: 0, tips: 0, currency: "MXN" } });
  }));
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(calculator: boolean) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{calculator
    ? <TableCalculator open tableId="table" tableLabel="1" currency="MXN" onCollected={vi.fn()} onClose={vi.fn()} />
    : <SettleTableDialog open tableId="table" restaurantId="restaurant" tableLabel="1" currency="MXN" canApprove={false} onSettled={vi.fn()} onClose={vi.fn()} />}
  </SWRConfig>));
}

it.each([false, true])("shows the card address and sends the skip with a part (calculator=%s)", async calculator => {
  await render(calculator);
  expect(host.textContent).toContain("El ticket se enviará a j***@hotmail.com");
  // One notice, not one from the bill sheet and another from the parts screen.
  expect([...host.querySelectorAll("label")].filter(l => l.textContent === t("cardEmail.skip"))).toHaveLength(1);
  await act(async () => slotBox(0).click());
  await act(async () => skipBox()!.click());
  await act(async () => cash().click());
  expect(collects()).toEqual([expect.objectContaining({ slots: [0], skipTicketEmail: true })]);
  // "Esta vez": the next part starts unticked again.
  expect(skipBox()!.checked).toBe(false);
});
it("sends skipTicketEmail false when the cashier leaves it", async () => {
  await render(false);
  await act(async () => slotBox(0).click());
  await act(async () => cash().click());
  expect(collects()).toEqual([expect.objectContaining({ skipTicketEmail: false })]);
});
it("a retry after a lost reply keeps its reference when only the email choice changed", async () => {
  await render(false);
  await act(async () => slotBox(0).click());
  vi.mocked(fetch).mockRejectedValueOnce(new Error("lost reply"));
  await act(async () => cash().click());
  await act(async () => skipBox()!.click());
  await act(async () => cash().click());
  const [first, second] = collects();
  expect(second.ref).toBe(first.ref);
  expect([first.skipTicketEmail, second.skipTicketEmail]).toEqual([false, true]);
});
