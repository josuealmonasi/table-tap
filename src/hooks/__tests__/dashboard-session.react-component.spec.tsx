// @vitest-environment jsdom
import { act } from "react";
import { expect, it } from "vitest";
import { advance, answer, calls, emit, identity, latest, notice, render } from "./dashboard-cache-harness";

it.each([
  "next:session:restaurant:owner", "user:next:restaurant:owner",
  "user:session:other:owner", "user:session:restaurant:waiter",
])("starts an empty cache when identity changes to %s", async scope => {
  await render();
  calls.mockImplementation(() => new Promise(() => {}));
  await render(`${scope}:9999999999`);
  expect(latest[0].badges).toEqual({});
  expect(latest[0].bell.notifications).toEqual([]);
  expect(calls).toHaveBeenCalledTimes(4);
});

it("keeps the cache through a token refresh and a moving offline expiry", async () => {
  await render();
  await emit("TOKEN_REFRESHED");
  await render(identity.replace("9999999999", "9999999998"));
  expect(calls).toHaveBeenCalledTimes(2);
  expect(latest[0].bell.unread).toBe(2);
});

it("clears on sign-out and requires server proof for the next sign-in", async () => {
  await render();
  await emit("SIGNED_OUT");
  expect(latest[0].badges).toEqual({});
  expect(latest[0].bell.notifications).toEqual([]);
  await emit("SIGNED_IN", "next", "next-session");
  await advance(60_001);
  expect(calls).toHaveBeenCalledTimes(2);
  answer(3, 1);
  await render("next:next-session:restaurant:owner:9999999999");
  expect(latest[0].badges["/dashboard/orders"]).toBe(1);
  expect(latest[0].bell.unread).toBe(3);
});

it("rejects late reads from a retired session", async () => {
  let finish!: (response: Response) => void;
  calls.mockImplementation(url => String(url).includes("notifications")
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ badges: {} }))));
  await render();
  await emit("SIGNED_OUT");
  answer(3, 1);
  await render("next:next-session:restaurant:owner:9999999999");
  await act(async () => finish(new Response(JSON.stringify({ notifications: [notice], unread: 99 }))));
  expect(latest[0].bell.unread).toBe(3);
});

it("shares optimistic read markers, avoids duplicate decrements and reconciles failed writes on polling", async () => {
  await render(undefined, 2);
  calls.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") throw new TypeError("offline");
    return new Response(JSON.stringify({ notifications: [notice], unread: 2 }));
  });
  await act(async () => latest[0].bell.markRead("n1"));
  expect(latest.map(p => p.bell.unread)).toEqual([1, 1]);
  await act(async () => latest[1].bell.markRead("n1"));
  expect(latest.map(p => p.bell.unread)).toEqual([1, 1]);
  await act(async () => latest[0].bell.markAllRead());
  expect(latest.map(p => p.bell.unread)).toEqual([0, 0]);
  expect(calls.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(3);
  expect(calls.mock.calls.filter(([, init]) => init?.method !== "POST")).toHaveLength(2);
  answer();
  await advance(30_001);
  expect(latest.map(p => p.bell.unread)).toEqual([2, 2]);
  expect(latest[0].bell.notifications[0].read_at).toBeNull();
});

it("does not let an older poll undo a read marker", async () => {
  await render();
  let finish!: (response: Response) => void;
  calls.mockImplementation((url, init) => String(url).includes("notifications") && init?.method !== "POST"
    ? new Promise(resolve => { finish = resolve; })
    : Promise.resolve(new Response(JSON.stringify({ badges: {} }))));
  await advance(30_001);
  await act(async () => latest[0].bell.markRead("n1"));
  await act(async () => finish(new Response(JSON.stringify({ notifications: [notice], unread: 2 }))));
  expect(latest[0].bell.unread).toBe(1);
  expect(latest[0].bell.notifications[0].read_at).not.toBeNull();
});
