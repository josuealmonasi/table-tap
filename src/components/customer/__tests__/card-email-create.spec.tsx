// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import LoyaltyOffer from "../LoyaltyOffer";
vi.mock("next/navigation", () => ({ usePathname: () => "/r/restaurant" }));
vi.mock("@/components/loyalty/CardDownload", () => ({ default: () => null }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
let root: Root, host: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "K7QM3XW9K7P2", face: { printedCode: "K7QM-3XW9-K7P2" }, qr: [] })));
  host = document.createElement("div"); root = createRoot(host);
  await act(async () => root.render(<LoyaltyOffer asked offer={{ restaurantId: "r", restaurantName: "Cafe", goal: 8, reward: "Coffee", steps: [{ visits: 8, reward: "Coffee" }], pass: "pass" }} />));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
async function type(value: string) {
  const input = host.querySelector<HTMLInputElement>('input[type="email"]')!;
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("requires fresh consent with an optional email and sends both on creation", async () => {
  await type("diner@example.com");
  const create = host.querySelector<HTMLButtonElement>("button")!;
  expect(create.disabled).toBe(true);
  expect(host.querySelector('a[href="/privacidad"]')).not.toBeNull();
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => create.click());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ restaurantId: "r", pass: "pass", email: "diner@example.com", consent: true });
});
it("keeps making a card without an email optional", async () => {
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ restaurantId: "r", pass: "pass" });
});
