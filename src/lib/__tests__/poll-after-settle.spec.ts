// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pollAfterSettle, readTimeoutMs } from "@/lib/poll-after-settle";

let poll: ReturnType<typeof pollAfterSettle>;
let visibility: "visible" | "hidden";
const read = vi.fn<(signal?: AbortSignal) => Promise<unknown>>();
const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms);
beforeEach(() => {
  vi.useFakeTimers(); visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  read.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { poll.stop(); vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });

it.each(["success", "rejection", "throw"])("waits after %s, including response body work", async result => {
  let finish!: () => void;
  read.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
    finish = () => result === "rejection" ? reject(new Error("offline")) : resolve();
    if (result === "throw") throw new Error("offline");
  }));
  poll = pollAfterSettle(read, 1_000);
  await advance(0);
  if (result !== "throw") {
    await advance(5_000); expect(read).toHaveBeenCalledOnce(); finish(); await advance(0);
  }
  await advance(999); expect(read).toHaveBeenCalledOnce();
  await advance(1); expect(read).toHaveBeenCalledTimes(2);
});

it("joins focus and visibility refreshes while a read is running, with one timer afterwards", async () => {
  let finish!: () => void;
  read.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  poll = pollAfterSettle(read, 1_000, { refreshOnVisible: true, refreshOnFocus: true });
  await advance(0);
  window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
  const joined = poll.refresh(); finish(); await joined;
  expect(read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(1);
  await advance(1_000); expect(read).toHaveBeenCalledTimes(2);
});

it("pauses hidden polls and reads on return without overlapping the pending read", async () => {
  visibility = "hidden";
  poll = pollAfterSettle(read, 1_000, { pauseWhenHidden: true, refreshOnVisible: true });
  await advance(5_000); expect(read).not.toHaveBeenCalled();
  visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); await advance(0);
  expect(read).toHaveBeenCalledOnce();
  visibility = "hidden"; await advance(5_000); expect(read).toHaveBeenCalledOnce();
  visibility = "visible"; document.dispatchEvent(new Event("visibilitychange")); await advance(0);
  expect(read).toHaveBeenCalledTimes(2);
});

it("keeps background polling when the caller never paused hidden tabs", async () => {
  visibility = "hidden";
  poll = pollAfterSettle(read, 1_000);
  await advance(2_000); expect(read).toHaveBeenCalledTimes(3);
});

it("removes events and never rearms after stopping during a read", async () => {
  let finish!: () => void;
  read.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  poll = pollAfterSettle(read, 1_000, { refreshOnVisible: true, refreshOnFocus: true });
  await advance(0); poll.stop(); finish(); await advance(5_000);
  window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); await poll.refresh();
  expect(read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});

it("supports a delayed first probe and a one-shot bill with event refreshes", async () => {
  poll = pollAfterSettle(read, 1_000, { immediate: false });
  await advance(999); expect(read).not.toHaveBeenCalled();
  await advance(1); expect(read).toHaveBeenCalledOnce(); poll.stop(); read.mockClear();
  poll = pollAfterSettle(read, null, { refreshOnFocus: true });
  await advance(10_000); expect(read).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event("focus")); await advance(0); expect(read).toHaveBeenCalledTimes(2);
});

it("does not start a queued read after immediate teardown", async () => {
  poll = pollAfterSettle(read, 1_000);
  poll.stop(); await advance(0);
  expect(read).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("audit #648: a read that never answers fails after max(2 x interval, 15 s) and the poll goes on", async () => {
  const signals: AbortSignal[] = [];
  read.mockImplementationOnce(signal => { signals.push(signal as AbortSignal); return new Promise(() => {}); });
  poll = pollAfterSettle(read, 1_000);
  await advance(0); expect(read).toHaveBeenCalledOnce();
  await advance(14_999); expect(read).toHaveBeenCalledOnce(); expect(signals[0].aborted).toBe(false);
  await advance(1); expect(signals[0].aborted).toBe(true);
  await advance(1_000); expect(read).toHaveBeenCalledTimes(2);
  await advance(1_000); expect(read).toHaveBeenCalledTimes(3);
});

it("audit #648: a slow interval gets twice its length before a read is abandoned", () => {
  expect(readTimeoutMs(1_000)).toBe(15_000);
  expect(readTimeoutMs(null)).toBe(15_000);
  expect(readTimeoutMs(30_000)).toBe(60_000);
});
