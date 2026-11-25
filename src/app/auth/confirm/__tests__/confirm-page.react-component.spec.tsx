// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/context";
import { messagesFor, translate } from "@/lib/i18n";
import ConfirmPage from "../page";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function renderLink(url: string) {
  window.history.replaceState(null, "", url);
  await act(async () => root.render(
    <StrictMode><LocaleProvider locale="en"><ConfirmPage /></LocaleProvider></StrictMode>,
  ));
}

it("clears the fragment and sends the token only when the person confirms", async () => {
  const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
  host.addEventListener("submit", submit);
  const path = "/auth/confirm?next=%2Freset-password&lang=en";
  await renderLink(`${path}#token_hash=fixture-token&type=recovery`);

  expect(window.location.pathname + window.location.search).toBe(path);
  expect(window.location.hash).toBe("");
  expect(submit).not.toHaveBeenCalled();

  const form = host.querySelector("form")!;
  expect(form.getAttribute("action")).toBe("/auth/callback");
  expect(form.method).toBe("post");
  const button = form.querySelector("button")!;
  expect(button.textContent).toBe(translate(messagesFor("en"), "authConfirm.button.recovery"));
  button.click();

  expect(submit).toHaveBeenCalledOnce();
  expect(Object.fromEntries(new FormData(form))).toEqual({
    token_hash: "fixture-token", type: "recovery", next: "/reset-password",
  });
});

it("clears a malformed fragment and offers no form", async () => {
  await renderLink("/auth/confirm#token_hash=short&type=recovery");

  expect(window.location.hash).toBe("");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(translate(messagesFor("en"), "authConfirm.broken"));
});
