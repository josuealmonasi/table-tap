// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
import { useLoyaltyCommand, type LoyaltyAnswer, type LoyaltyCommand } from "@/hooks/useLoyaltyCommand";

// Both visit-card screens send through this one lifecycle. What it must keep:
// one request at a time, a redemption's saved key until it is answered, and
// that key forgotten once it is.
let host: HTMLDivElement, root: Root;
let send!: (c: LoyaltyCommand) => Promise<LoyaltyAnswer>;
function Probe() { send = useLoyaltyCommand().run; return null; }
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const redeem = { path: "/api/loyalty/redeem", body: {}, redeem: { code: "K7QM", round: 2, step: 5 } };
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

it("retries a lost redemption with the same saved key, and forgets it once answered", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
  expect(await act(() => send(redeem))).toEqual({ status: "failed", error: "done.networkError" });
  expect(await act(() => send(redeem))).toEqual({ status: "done", data: { ok: true } });
  expect(bodyOf(fetcher.mock.calls[1]).requestKey).toBe(bodyOf(fetcher.mock.calls[0]).requestKey);
  expect(Object.keys(localStorage).filter(k => k.startsWith("tt-loyalty-redeem:"))).toEqual([]);
});

it("refuses a redemption whose round is unknown instead of guessing", async () => {
  vi.stubGlobal("fetch", vi.fn());
  expect(await act(() => send({ ...redeem, redeem: { code: "K7QM", round: null, step: 5 } })))
    .toEqual({ status: "refused", error: "apiErr.loyaltyRoundChanged" });
  expect(fetch).not.toHaveBeenCalled();
});

it("sends one request at a time", async () => {
  let answer!: (r: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(r => { answer = r; })));
  let first!: Promise<LoyaltyAnswer>;
  await act(async () => { first = send({ path: "/api/loyalty/stamp", body: { code: "K7QM" } }); });
  expect(await act(() => send({ path: "/api/loyalty/stamp", body: { code: "K7QM" } }))).toEqual({ status: "busy" });
  await act(async () => answer(Response.json({ ok: true })));
  expect((await first).status).toBe("done");
  expect(fetch).toHaveBeenCalledTimes(1);
});
