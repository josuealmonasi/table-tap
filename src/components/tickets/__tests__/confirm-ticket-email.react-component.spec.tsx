// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import ConfirmTicketEmail from "../ConfirmTicketEmail.react-component";

vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => translate(messagesFor("en"), key) }));

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn());
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("opening the inbox link does nothing until the recipient confirms", async () => {
  const token = "A".repeat(43);
  vi.mocked(fetch).mockResolvedValue(Response.json({ ok: true }));
  await act(async () => root.render(<ConfirmTicketEmail token={token} />));
  expect(fetch).not.toHaveBeenCalled();
  await act(async () => host.querySelector("button")!.click());
  expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/tickets/confirm", expect.objectContaining({
    method: "POST", body: JSON.stringify({ token }),
  }));
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Your visit card will now send tickets to this address.");
});
