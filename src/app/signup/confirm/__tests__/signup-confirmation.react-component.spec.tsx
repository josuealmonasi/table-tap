// @vitest-environment jsdom
import React, { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/i18n/context";
import ConfirmSignupPage from "../page";

vi.mock("next/navigation", () => ({ useRouter: () => ({}) }));

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn();
const token = "a".repeat(64);
const copy = messagesFor("en").auth;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function renderLink(value: string): Promise<void> {
  window.history.replaceState(null, "", `/signup/confirm#token=${value}`);
  await act(async () => root.render(
    <StrictMode><LocaleProvider locale="en"><ConfirmSignupPage /></LocaleProvider></StrictMode>,
  ));
}

it("clears the token from the address and waits for the owner to submit a password", async () => {
  await renderLink(token);
  expect(window.location.hash).toBe("");
  expect(fetchMock).not.toHaveBeenCalled();

  const password = "Restaurant password";
  const field = host.querySelector<HTMLInputElement>('input[type="password"]')!;
  expect(field.autocomplete).toBe("new-password");
  field.value = password;
  fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: copy.signupLinkInvalid }) });
  await act(async () => host.querySelector("button")!.click());

  expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/signup/confirm", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ token, password }),
  }));
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(copy.signupLinkInvalid);
});

it("shows how to restart from an invalid link without offering a password field", async () => {
  await renderLink("invalid");
  expect(host.querySelector("form")).toBeNull();
  expect(host.querySelector('a[href="/signup"]')?.textContent).toBe(copy.startSignupAgain);
  expect(fetchMock).not.toHaveBeenCalled();
});
