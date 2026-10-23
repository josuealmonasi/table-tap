// @vitest-environment jsdom
import { act } from "react";
import { expect, it, vi } from "vitest";
import { badgesChanged } from "@/lib/badge-events";
import { advance, answer, calls, latest, render } from "./dashboard-cache-harness";

it("shares reads and action invalidation across consumers", async () => {
  await render(undefined, 2);
  expect(calls).toHaveBeenCalledTimes(2);
  expect(latest.map(p => p.badges["/dashboard/orders"])).toEqual([7, 7]);
  await advance(30_001);
  expect(calls).toHaveBeenCalledTimes(4);
  answer(2, 8);
  await act(async () => badgesChanged());
  expect(calls).toHaveBeenCalledTimes(5);
  expect(latest.map(p => p.badges["/dashboard/orders"])).toEqual([8, 8]);
});

it("skips hidden and offline polls, then refreshes on visibility and reconnect", async () => {
  await render();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await advance(60_001);
  expect(calls).toHaveBeenCalledTimes(2);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await advance(1);
  expect(calls).toHaveBeenCalledTimes(4);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  await act(async () => window.dispatchEvent(new Event("offline")));
  await advance(60_001);
  expect(calls).toHaveBeenCalledTimes(4);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => window.dispatchEvent(new Event("online")));
  await advance(1);
  expect(calls).toHaveBeenCalledTimes(6);
});

it.each([429, 503, "network"])("keeps last-good data after %s and recovers automatically", async failure => {
  await render();
  calls.mockImplementation(async () => {
    if (typeof failure === "string") throw new TypeError("offline");
    return new Response(null, { status: failure });
  });
  await advance(30_001);
  expect(calls).toHaveBeenCalledTimes(4);
  expect(latest[0].badges["/dashboard/orders"]).toBe(7);
  expect(latest[0].bell.unread).toBe(2);
  answer(4, 9);
  await advance(30_001);
  expect(latest[0].badges["/dashboard/orders"]).toBe(9);
  expect(latest[0].bell.unread).toBe(4);
});

it("stops badge polling after a forbidden answer", async () => {
  calls.mockResolvedValue(new Response(null, { status: 403 }));
  await render(undefined, 1, false);
  expect(calls).toHaveBeenCalledTimes(1);
  await advance(120_001);
  expect(calls).toHaveBeenCalledTimes(1);
  expect(latest[0].badges).toEqual({});
});

it("makes no reads or writes without a verified scope", async () => {
  await render(null);
  await act(async () => { latest[0].bell.markRead("n1"); latest[0].bell.markAllRead(); badgesChanged(); });
  await advance(60_001);
  expect(calls).not.toHaveBeenCalled();
});
