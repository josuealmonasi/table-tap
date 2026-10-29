// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CheckPayment from "../CheckPayment";
import { messagesFor, translate } from "@/lib/i18n";
const s = vi.hoisted(() => ({ locale: "en" as "en" | "es", toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => translate(messagesFor(s.locale), key) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => s.toast }));
let root: Root, host: HTMLDivElement;
const refresh = vi.fn();
const scope = { kind: "orders" as const, orderIds: ["the-refused-order"] };
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.clearAllMocks();
  host = document.createElement("div"); root = createRoot(host); refresh.mockResolvedValue(undefined);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it.each(["en", "es"] as const)("shows every outcome in %s and sends only a status request", async locale => {
  s.locale = locale;
  for (const outcome of ["closed", "paid", "unverified", "missing_identity"]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ outcome })));
    await act(async () => root.render(<CheckPayment key={outcome} scope={scope} onRefresh={refresh} />));
    expect(host.querySelector("button")?.textContent).toBe(locale === "en" ? "Check payment" : "Revisar pago");
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("[role=status]")?.textContent).toBe(translate(messagesFor(locale), `paymentCheck.${outcome}`));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/checkout/check", expect.objectContaining({ body: JSON.stringify(scope) }));
  }
  expect(refresh).toHaveBeenCalledTimes(4);
});
it.each(["network", "bad json", "http", "unknown", "refresh"])("a %s failure never claims closure", async failure => {
  s.locale = "en";
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
    if (failure === "network") throw new Error("offline");
    if (failure === "bad json") return new Response("bad");
    return Response.json({ outcome: failure === "unknown" ? "other" : "closed" }, { status: failure === "http" ? 503 : 200 });
  }));
  if (failure === "refresh") refresh.mockRejectedValue(new Error("read failed"));
  await act(async () => root.render(<CheckPayment scope={scope} onRefresh={refresh} />));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain(translate(messagesFor("en"), "paymentCheck.unverified"));
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("holds duplicate taps and waits for the balance before saying it refreshed", async () => {
  let finish!: () => void;
  refresh.mockImplementation(() => new Promise<void>(done => { finish = done; }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ outcome: "closed" })));
  await act(async () => root.render(<CheckPayment scope={scope} onRefresh={refresh} />));
  await act(async () => { host.querySelector("button")!.click(); host.querySelector("button")!.click(); });
  expect(fetch).toHaveBeenCalledTimes(1); expect(host.querySelector("button")!.disabled).toBe(true);
  expect(host.querySelector("[role=status]")).toBeNull();
  await act(async () => finish());
  expect(host.querySelector("[role=status]")?.textContent).toContain("refreshed");
});

it("keeps the paid warning when the refreshed balance cannot be read", async () => {
  s.locale = "en"; refresh.mockRejectedValue(new Error("read failed"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ outcome: "paid" })));
  await act(async () => root.render(<CheckPayment scope={scope} onRefresh={refresh} />));
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toContain("Do not collect it again");
});
