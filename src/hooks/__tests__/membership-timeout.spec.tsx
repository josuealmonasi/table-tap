// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePendingPhones } from "@/hooks/usePendingPhones";
import { useTableMembership } from "@/hooks/useTableMembership";

let root: Root;
let signals: AbortSignal[];
const calls = vi.fn<typeof fetch>();
function Probe({ floor }: { floor: boolean }) {
  usePendingPhones("restaurant", floor);
  useTableMembership("restaurant", floor ? null : "table");
  return null;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  signals = [];
  calls.mockReset().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
    const signal = options?.signal;
    if (signal) {
      signals.push(signal);
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }
  }));
  vi.stubGlobal("fetch", calls);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});
it.each([true, false])("aborts a stalled membership read and polls again (floor=%s)", async floor => {
  await act(async () => root.render(<Probe floor={floor} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
  expect(signals[0]?.aborted).toBe(true);
  expect(calls.mock.calls.length).toBeGreaterThan(1);
});
it.each([true, false])("aborts a membership read on teardown (floor=%s)", async floor => {
  await act(async () => root.render(<Probe floor={floor} />));
  await act(async () => root.unmount());
  expect(signals[0]?.aborted).toBe(true);
});
it("times out a diner read waiting for another tab's membership lock", async () => {
  vi.stubGlobal("navigator", { locks: { request: (_name: string, options: { signal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      if (options.signal) {
        signals.push(options.signal);
        options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      }
    }),
  } });
  await act(async () => root.render(<Probe floor={false} />));
  await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
  expect(signals[0]?.aborted).toBe(true);
  expect(signals.length).toBeGreaterThan(1);
  expect(calls).not.toHaveBeenCalled();
});

it.each([true, false])("aborts a stalled membership body and accepts the next reply (floor=%s)", async floor => {
  calls.mockImplementationOnce(async (_url, options) => {
    const signal = options!.signal!;
    signals.push(signal);
    return new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")), { once: true });
      },
    }));
  });
  await act(async () => root.render(<Probe floor={floor} />));
  calls.mockResolvedValue(Response.json({ status: "pending", sessionId: null, pending: [] }));
  await act(async () => { await vi.advanceTimersByTimeAsync(25_000); });
  expect(signals[0]?.aborted).toBe(true);
  expect(calls.mock.calls.length).toBeGreaterThan(1);
});
