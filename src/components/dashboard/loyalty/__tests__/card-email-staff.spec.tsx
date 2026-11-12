// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { standing } from "@/lib/loyalty/standing";
import StampOutcome from "../StampOutcome";
import CardLookupResult from "../CardLookupResult";
import AttachCard from "../AttachCard.react-component";
const f = vi.hoisted(() => ({ scan: null as null | ((raw: string) => string) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/dashboard/QrScanner", () => ({ default: ({ onRead }: { onRead: typeof f.scan }) => { f.scan = onRead; return <span data-scanner />; } }));
let root: Root, host: HTMLDivElement;
const code = "K7QM3XW9K7P2";
const progress = standing(1, [{ visits: 8, reward: "Coffee" }]);
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => String(url).startsWith("/api/loyalty/card-email?") ? Response.json({ email: "j***@hotmail.com" })
    : Response.json({ enabled: true, card: { suffix: "K7P2", progress: 1, goal: 8 } })));
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function render(children: React.ReactNode) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>));
}
it.each(["stamp", "lookup", "attach"])("%s exposes the shared masked email editor", async screen => {
  await render(screen === "stamp" ? <StampOutcome outcome={{ code, standing: progress, round: 1, kind: "stamp", stamped: true }} busy={false} error={null} onRedeem={vi.fn()} onAnother={vi.fn()} />
    : screen === "lookup" ? <CardLookupResult card={{ code, standing: progress, round: 1, since: "2026-11-11", visits: [], redeemed: [] }} active onChanged={vi.fn()} />
      : <AttachCard active target={{ preview: true }} selection={{ code, suffix: "K7P2", progress: 1, goal: 8 }} />);
  expect(host.textContent).toContain("j***@hotmail.com"); expect(host.textContent).toContain("Agregar/cambiar correo");
  expect(vi.mocked(fetch).mock.calls.some(([url]) => url === `/api/loyalty/card-email?code=${code}`)).toBe(true);
});
it("an existing bill can scan its card to edit without receiving its bearer code from the bill", async () => {
  await render(<AttachCard active target={{ tableId: "table" }} />);
  expect(host.textContent).toContain("Escanea la tarjeta para consultar su correo");
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Agregar/cambiar correo")!.click());
  await act(async () => { f.scan!("https://tabletap.test/rewards?c=K7QM3XW9K7P2"); });
  expect(host.textContent).toContain("j***@hotmail.com");
});
it("refuses a different card while checking an attached card's email", async () => {
  await render(<AttachCard active target={{ tableId: "table" }} />);
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Agregar/cambiar correo")!.click());
  await act(async () => { f.scan!("K7QM3XW9ABCD"); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("···· K7P2");
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).startsWith("/api/loyalty/card-email?"))).toBe(false);
});
