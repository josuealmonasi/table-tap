// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import RewardsLookup from "../RewardsLookup";
const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);
vi.mock("@/lib/i18n/context", () => ({ useT: () => t, useLocale: () => ({ locale: "es" }) }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("../RewardsCard", () => ({ default: () => <div>Card</div> }));
vi.mock("@/components/loyalty/CardDownload", () => ({ default: () => null }));
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ email: "diner@example.com", face: { printedCode: "K7QM-3XW9-K7P2" }, restaurant: { id: "r" }, qr: [] })));
  host = document.createElement("div"); root = createRoot(host);
});
it("directs the guest to the restaurant when this browser cannot delete the card", async () => {
  await act(async () => root.render(<RewardsLookup initialCode="K7QM3XW9K7P2" />));
  expect(host.textContent).toContain("Pide al restaurante que borre esta tarjeta.");
  expect(host.textContent).toContain(t("cardEmail.ownerRequired"));
  expect([...host.querySelectorAll("button")].some(b => b.textContent === t("cardEmail.edit"))).toBe(false);
  expect([...host.querySelectorAll("button")].some(b => b.textContent === "Borrar mi tarjeta")).toBe(false);
});

it("deletes the displayed card when authorized", async () => {
  const code = "K7QM3XW9K7P2";
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ canDelete: true, email: null, face: { printedCode: code }, restaurant: { id: "r" } }));
  await act(async () => root.render(<RewardsLookup initialCode={code} />));
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ ok: true }));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Borrar mi tarjeta")!.click());
  expect(fetch).toHaveBeenCalledWith(`/api/rewards?c=${code}`, { method: "DELETE" });
  expect(host.textContent).toContain("Tu tarjeta se borró");
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("shows the active masked address and lets the owner remove it", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({
    canDelete: true, email: "d***@example.com", face: { printedCode: "K7QM-3XW9-K7P2" }, restaurant: { id: "r" },
  }));
  await act(async () => root.render(<RewardsLookup initialCode="K7QM3XW9K7P2" />));
  expect(host.textContent).toContain("d***@example.com");
  expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).toEqual(["/api/rewards?c=K7QM3XW9K7P2"]);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ outcome: "removed" }));
  await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent === "Quitar correo")!.click());
  expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string)).toEqual({ code: "K7QM3XW9K7P2", email: null, consent: false });
  expect(host.textContent).toContain("Sin correo");
});
