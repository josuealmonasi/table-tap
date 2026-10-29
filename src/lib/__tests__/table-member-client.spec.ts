import { afterEach, expect, it, vi } from "vitest";
import { requestPhoneMembership } from "@/lib/table-member-client";

afterEach(() => { vi.unstubAllGlobals(); });
it("serializes two initial loads so the second uses the credential the first received", async () => {
  let issued = false;
  let made = 0;
  let release: () => void = () => {};
  let started: () => void = () => {};
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const firstReply = new Promise<void>(resolve => { release = resolve; });
  const fetch = vi.fn(async () => {
    if (!issued) made++;
    if (fetch.mock.calls.length === 1) { started(); await firstReply; }
    issued = true;
    return Response.json({ status: "empty", sessionId: null, diner: null, pass: "" });
  });
  vi.stubGlobal("navigator", {});
  vi.stubGlobal("fetch", fetch);
  const first = requestPhoneMembership("r", "t");
  const second = requestPhoneMembership("r", "t");
  await firstStarted;
  expect(fetch).toHaveBeenCalledOnce();
  release();
  await Promise.all([first, second]);
  expect(made).toBe(1);
});
it("uses the browser's same-origin lock and recovers the queue after a refused request", async () => {
  const lock = vi.fn(async (_name: string, _options: LockOptions, run: () => Promise<unknown>) => run());
  vi.stubGlobal("navigator", { locks: { request: lock } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ status: "pending", sessionId: "s", diner: "m", pass: "" })));
  await expect(requestPhoneMembership("r", "t")).rejects.toThrow();
  expect(await requestPhoneMembership("r", "t")).toMatchObject({ status: "pending" });
  expect(lock).toHaveBeenCalledWith("tt-table-member", { signal: expect.any(AbortSignal) }, expect.any(Function));
});
