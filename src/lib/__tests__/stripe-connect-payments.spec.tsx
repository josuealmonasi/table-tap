// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const t = (key: string) => key;
vi.mock("@/lib/i18n/context", () => ({ useT: () => t }));
import PaymentsCard from "@/components/dashboard/settings/PaymentsCard";
const fetcher = vi.fn();
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it.each(["HTTP", "network", "invalid JSON"])("shows a %s status failure without claiming Stripe is disconnected", async failure => {
  if (failure === "network") fetcher.mockRejectedValueOnce(new Error("offline"));
  else if (failure === "invalid JSON") fetcher.mockResolvedValueOnce({ ok: false, json: async () => { throw new Error("HTML response"); } });
  else fetcher.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "existing error copy" }) });
  await act(async () => root.render(<PaymentsCard />));
  expect(container.textContent).toContain(failure === "HTTP" ? "existing error copy" : "notice.network");
  expect(container.textContent).not.toContain("dash.connectPrompt");
  // An unavailable status must not prevent the owner resuming onboarding.
  expect(container.querySelector("button")?.disabled).toBe(false);
});

it("shows the connect prompt only after a successful disconnected response", async () => {
  fetcher.mockResolvedValueOnce({ ok: true, json: async () => ({ connected: false, chargesEnabled: false, detailsSubmitted: false }) });
  await act(async () => root.render(<PaymentsCard />));
  expect(container.textContent).toContain("dash.connectPrompt");
});
