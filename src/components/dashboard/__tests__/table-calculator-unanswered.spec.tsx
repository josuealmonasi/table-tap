// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import TableCalculator from "../TableCalculator";

const s = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => s.toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div role="dialog">{children}</div> : null }));
let root: Root, host: HTMLDivElement;
const t = (key: string) => translate(messagesFor("en"), key);
const order = { id: "order", session_id: "session", total: 100, subtotal: 100, collected: 0, currency: "MXN", paid: false, status: "received", items: [] };
const cash = () => [...host.querySelectorAll("button")].find(b => b.textContent?.startsWith(t("settle.cash")))!;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("resends an unanswered collection unchanged, and only then starts a new one (journey B, finding 1)", async () => {
  let posts = 0;
  // The first collection was recorded; only its reply was lost. The bill polls
  // and now shows what is left, and the old screen offered a new collection.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    const owed = posts === 0 ? 100 : 30;
    if (init?.method !== "POST") return Response.json({ orders: [order], splits: [], outstanding: { owed, ordered: 100, collected: 100 - owed, tips: 0, currency: "MXN" } });
    posts++;
    if (posts === 1) throw new TypeError("network lost after the write");
    return Response.json({ settled: false, amount: 100, tip: 0, currency: "MXN", owed: 0, ordered: 100, collected: 100, tips: 0 });
  }));
  await act(async () => root.render(<TableCalculator open onClose={vi.fn()} currency="MXN" tableId="table" tableLabel="1" onCollected={vi.fn()} />));
  await act(async () => cash().click());
  expect(host.textContent).toContain(t("settle.unansweredCollection"));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  await act(async () => cash().click());
  await act(async () => cash().click());
  const bodies = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => JSON.parse(String(init!.body)));
  expect(bodies).toHaveLength(3);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2].ref).not.toBe(bodies[0].ref);
  expect(host.textContent).not.toContain(t("settle.unansweredCollection"));
  vi.useRealTimers();
});
