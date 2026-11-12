// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import StopTicketEmail from "../StopTicketEmail.react-component";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars) }));
let root: Root, host: HTMLDivElement;
const token = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ restaurant: "Cafe" })));
  host = document.createElement("div"); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("never unsubscribes on page load, including a Strict Mode mount", async () => {
  await act(async () => root.render(<React.StrictMode><StopTicketEmail token={token} /></React.StrictMode>));
  expect(fetch).not.toHaveBeenCalled(); expect(host.textContent).toContain("¿Dejar de recibir tus tickets por correo?");
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string)).toEqual({ token });
  expect(host.textContent).toContain("Ya no recibirás tickets de Cafe"); expect(host.querySelector("button")).toBeNull();
});
it.each([null, "bad-token"])("a missing or invalid token makes no request: %s", async token => {
  await act(async () => root.render(<StopTicketEmail token={token} />));
  expect(fetch).not.toHaveBeenCalled(); expect(host.querySelector("button")).toBeNull();
});
it("handles a gone link without claiming success", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({}, { status: 404 }));
  await act(async () => root.render(<StopTicketEmail token={token} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.textContent).toContain("Este enlace ya no está disponible"); expect(host.textContent).not.toContain("Ya no recibirás");
});
it("leaves the button available after a network failure", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  await act(async () => root.render(<StopTicketEmail token={token} />));
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(false);
});
