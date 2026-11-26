// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import SettleAccountDialog from "../accounts/SettleAccountDialog";

// Backlog 35, finding 1: the till's collection carries one reference per
// review and the orders it showed, so a retry after a lost answer is the same
// payment and a late first try cannot collect replacement debt.
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
let root: Root, host: HTMLDivElement;
const cash = () => [...host.querySelectorAll("button")].find(b => b.textContent === translate(messagesFor("en"), "settle.cash"))!;
const sent = () => vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
const dialog = (orderIds: string[]) => (
  <SettleAccountDialog open onClose={vi.fn()} accountId="acct" name="Ana" owed={100} currency="MXN" orderIds={orderIds} onSettled={vi.fn()} />
);

beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); root = createRoot(host);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("network"))
    .mockResolvedValue(Response.json({ error: "x" }, { status: 409 })));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("sends the reviewed orders and reuses the reference when retrying the same review", async () => {
  await act(async () => root.render(dialog([A])));
  await act(async () => cash().click());
  await act(async () => cash().click());
  const [first, retry] = sent();
  expect(first).toMatchObject({ accountId: "acct", expected: 100, currency: "MXN", orderIds: [A] });
  expect(typeof first.ref).toBe("string");
  expect(first.ref.length).toBeGreaterThan(0);
  expect(retry.ref).toBe(first.ref);
});

it("starts a new reference when the screen shows different orders", async () => {
  await act(async () => root.render(dialog([A])));
  await act(async () => cash().click());
  await act(async () => root.render(dialog([B])));
  await act(async () => cash().click());
  const [first, second] = sent();
  expect(second.orderIds).toEqual([B]);
  expect(second.ref).not.toBe(first.ref);
});

it("offers no collection while it has no orders to bind it to", async () => {
  await act(async () => root.render(dialog([])));
  expect(cash().disabled).toBe(true);
});
