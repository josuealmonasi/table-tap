// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { PRIVACY_PATH } from "@/lib/legal";

let locale: "es" | "en" = "es";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(locale), key, vars) }));

import PlaceIdentity from "../PlaceIdentity";
import PrivacyHint from "../PrivacyHint";

function render(node: React.ReactElement): HTMLDivElement {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  act(() => createRoot(host).render(node));
  return host;
}
afterEach(() => vi.unstubAllGlobals());

it.each([["es", "Aviso de privacidad"], ["en", "Privacy notice"]] as const)("shows who is paid, where, and the notice in %s", (l, link) => {
  locale = l;
  const host = render(<PlaceIdentity identity={{ name: "Tacos SA de CV", address: "Calle 1 22, Col. Centro, C.P. 06000" }} />);
  expect(host.textContent).toContain("Tacos SA de CV");
  expect(host.textContent).toContain("Col. Centro");
  const a = host.querySelector("a")!;
  expect(a.getAttribute("href")).toBe(PRIVACY_PATH);
  expect(a.textContent).toBe(link);
});

it("renders nothing without an identity", () => {
  expect(render(<PlaceIdentity identity={null} />).innerHTML).toBe("");
});

it.each([
  ["es", "email", "Usamos tu correo solo para enviarte el ticket. Aviso de privacidad"],
  ["en", "email", "We use your email only to send you the receipt. Privacy notice"],
  ["es", "name", "Usamos tu nombre solo para llamarte cuando tu pedido esté listo. Aviso de privacidad"],
  ["en", "name", "We use your name only to call you when your order is ready. Privacy notice"],
] as const)("the %s %s hint links the notice", (l, field, text) => {
  locale = l;
  const host = render(<PrivacyHint field={field} />);
  expect(host.textContent).toBe(text);
  expect(host.querySelector("a")!.getAttribute("href")).toBe(PRIVACY_PATH);
});
