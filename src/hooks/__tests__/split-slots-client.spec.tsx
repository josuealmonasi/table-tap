// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useSplit } from "../useSplit";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
let root: Root, hook: ReturnType<typeof useSplit>;
const split = { id: "split", modelVersion: 2, revision: 7, status: "locked", shares: 2, amount: 11,
  proposedBy: "member", joined: 0, mine: null, outstanding: 11, ownSince: 0, slots: [] };
function Harness() {
  hook = useSplit("restaurant", "table", "session", true, [], { expectedCents: 1100, currency: "MXN" });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url, init) => init?.method
    ? { ok: true, json: async () => ({ outcome: "started" }) }
    : { ok: true, json: async () => ({ diner: "member", split }) }));
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Harness /></SWRConfig>));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("starts model 2 using reviewed cents and refreshes its slots", async () => {
  await act(async () => hook.propose(20));
  const request = vi.mocked(fetch).mock.calls.find(([url, init]) => url === "/api/split/start" && init);
  expect(request).toBeDefined();
  expect(JSON.parse(request![1]!.body as string)).toMatchObject({ shares: 20, expectedCents: 1100, currency: "MXN" });
  expect(hook.split).toMatchObject({ revision: 7 });
});
it("cancels and resizes a slot split against the displayed revision", async () => {
  await act(async () => hook.cancel());
  await act(async () => hook.resize(3));
  const calls = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method);
  expect(calls.map(([url]) => url)).toEqual(["/api/split/cancel", "/api/split/resize"]);
  expect(calls.map(([, init]) => JSON.parse(init!.body as string).revision)).toEqual([7, 7]);
});
it("keeps the start reference across a lost answer", async () => {
  vi.mocked(fetch).mockRejectedValueOnce(new Error("lost answer"));
  await act(async () => hook.propose(2));
  await act(async () => hook.propose(2));
  const bodies = vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method).map(([, init]) => JSON.parse(init!.body as string));
  expect(bodies[1].ref).toBe(bodies[0].ref);
});
it("can start on a local phone without the secure-context randomUUID method", async () => {
  vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) });
  await act(async () => { await expect(hook.propose(3)).resolves.toBeUndefined(); });
  const call = vi.mocked(fetch).mock.calls.find(([url]) => url === "/api/split/start");
  expect(JSON.parse(call![1]!.body as string).ref).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
});

it("retires the start reference after cancellation even if the follow-up read fails", async () => {
  await act(async () => hook.propose(2));
  vi.mocked(fetch).mockImplementation(async (_url, init) => {
    if (!init?.method) throw new Error("read lost");
    return { ok: true, json: async () => ({ outcome: "cancelled" }) } as Response;
  });
  await act(async () => hook.cancel());
  await act(async () => hook.propose(2));
  const bodies = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/split/start").map(([, init]) => JSON.parse(init!.body as string));
  expect(bodies[1].ref).not.toBe(bodies[0].ref);
});
it("retires the start reference when a fresh read finds no live split", async () => {
  await act(async () => hook.propose(2));
  vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ diner: "member", split: null }) } as Response);
  await act(async () => hook.refresh());
  await act(async () => hook.propose(2));
  const bodies = vi.mocked(fetch).mock.calls.filter(([url]) => url === "/api/split/start").map(([, init]) => JSON.parse(init!.body as string));
  expect(bodies[1].ref).not.toBe(bodies[0].ref);
});
