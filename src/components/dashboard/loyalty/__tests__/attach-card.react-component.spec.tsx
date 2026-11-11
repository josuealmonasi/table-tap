// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
const f = vi.hoisted(() => ({ availability: { enabled: true, card: null as object | null }, mutate: vi.fn(),
  fetch: vi.fn(), scan: null as null | ((raw: string) => string), key: null as string | null }));
vi.mock("swr", () => ({ default: (key: string | null) => { f.key = key; return { data: key ? f.availability : undefined, mutate: f.mutate }; } }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
vi.mock("@/components/dashboard/QrScanner", () => ({ default: ({ onRead }: { onRead: typeof f.scan }) => { f.scan = onRead; return <span data-scanner />; } }));
import AttachCard from "../AttachCard.react-component";
import DeviceBillCard from "@/components/customer/DeviceBillCard.react-component";
let root: Root, el: HTMLDivElement;
const picked = vi.fn();
const target = { preview: true };
async function render(props: Partial<React.ComponentProps<typeof AttachCard>> = {}) {
  await act(async () => root.render(<AttachCard active target={target} onSelection={picked} {...props} />));
}
const button = (text: string) => Array.from(el.querySelectorAll("button")).find(b => b.textContent === text)!;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("fetch", f.fetch);
  el = document.createElement("div"); root = createRoot(el); localStorage.clear(); vi.clearAllMocks();
  f.availability = { enabled: true, card: null }; f.scan = null;
  f.fetch.mockResolvedValue(Response.json({ outcome: "attached", card: { suffix: "K7P2", progress: 5, goal: 8 } }));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each([false, true])("hides the selector when active=%s and the server says off", async active => {
  f.availability.enabled = false; await render({ active }); expect(el.textContent).toBe(""); expect(el.querySelector("button")).toBeNull();
});
it("offers Spanish code entry and the shared camera before payment", async () => {
  await render(); expect(el.textContent).toContain("Tarjeta de visitas"); expect(el.textContent).toContain("Usar tarjeta");
  expect(el.querySelector("[data-scanner]")).not.toBeNull(); expect(f.key).toContain("preview=true");
});
it("scans the QR bearer code and selects the returned standing", async () => {
  await render(); await act(async () => { expect(f.scan!("https://tabletap.test/rewards?c=K7QM3XW9K7P2")).toBe("taken"); });
  expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({ preview: true, code: "K7QM3XW9K7P2", remove: false });
  expect(picked).toHaveBeenCalledWith({ code: "K7QM3XW9K7P2", suffix: "K7P2", progress: 5, goal: 8 });
});
it("shows masked progress and removes a draft before charging", async () => {
  await render({ selection: { suffix: "K7P2", code: "K7QM3XW9K7P2", progress: 5, goal: 8 } });
  expect(el.textContent).toContain("Tarjeta ···· K7P2 · 5 de 8"); expect(el.textContent).not.toContain("K7QM");
  await act(async () => button("Quitar tarjeta").click()); expect(picked).toHaveBeenCalledWith(null); expect(f.fetch).not.toHaveBeenCalled();
});
it("does not allow scan attachment while charging", async () => {
  await render({ disabled: true }); await act(async () => { f.scan!("K7QM3XW9K7P2"); }); expect(f.fetch).not.toHaveBeenCalled();
});
it("does not show success when the server refuses a code", async () => {
  f.fetch.mockResolvedValue(Response.json({ error: "No encontramos esa tarjeta en este restaurante." }, { status: 404 }));
  await render(); await act(async () => { f.scan!("K7QM3XW9K7P2"); });
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("No encontramos"); expect(picked).not.toHaveBeenCalled();
});
it("the diner offers only the card saved on this device and names their sitting", async () => {
  localStorage.setItem("tt-loyalty:restaurant", JSON.stringify({ code: "K7QM3XW9K7P2" }));
  await act(async () => root.render(<DeviceBillCard restaurantId="restaurant" tableId="table" sessionId="sitting" disabled={false} onBusy={vi.fn()} />));
  expect(el.textContent).toContain("Usar mi tarjeta de visitas"); expect(el.querySelector("input")).toBeNull();
  await act(async () => button("Usar mi tarjeta de visitas").click());
  expect(JSON.parse(f.fetch.mock.calls[0][1].body)).toEqual({ restaurantId: "restaurant", tableId: "table", sessionId: "sitting", code: "K7QM3XW9K7P2", remove: false });
});
it.each([null, { declined: true }, { code: "bad" }])("a phone without a valid card offers nothing: %j", async saved => {
  if (saved) localStorage.setItem("tt-loyalty:restaurant", JSON.stringify(saved));
  await act(async () => root.render(<DeviceBillCard restaurantId="restaurant" tableId="table" sessionId="sitting" disabled={false} onBusy={vi.fn()} />));
  expect(el.textContent).toBe("");
});
