// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePendingPhones } from "@/hooks/usePendingPhones";
import { MEMBER_POLL_MS } from "@/lib/poll";

/**
 * A fixed 5 s interval kept polling however long the read took. With a read
 * slower than the interval Pedidos always had a request in flight, never went
 * quiet, and the layout gate timed it out. The next read now waits for the
 * last one to settle.
 */
const LATENCY = 6_000;
let root: Root;
let inFlight = 0;
let maxInFlight = 0;
let starts: number[] = [];
let settles: number[] = [];
const calls = vi.fn<typeof fetch>();

function Probe() {
  usePendingPhones("restaurant", true);
  return null;
}

function slowReply(fail: boolean) {
  return () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    starts.push(Date.now());
    return new Promise<Response>((resolve, reject) => setTimeout(() => {
      inFlight--;
      settles.push(Date.now());
      if (fail) reject(new Error("offline"));
      else resolve(Response.json({ pending: [] }));
    }, LATENCY));
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  inFlight = 0; maxInFlight = 0; starts = []; settles = [];
  vi.stubGlobal("fetch", calls);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
  calls.mockReset();
});

it.each([false, true])("keeps one read in flight and waits a full interval after each settles (failing=%s)", async fail => {
  calls.mockImplementation(slowReply(fail));
  await act(async () => root.render(<Probe />));
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(maxInFlight).toBe(1);
  // Each cycle is latency plus the interval: 60 s fits five reads, not twelve.
  expect(starts.length).toBe(Math.ceil(60_000 / (LATENCY + MEMBER_POLL_MS)));
  for (let i = 1; i < starts.length; i++) expect(starts[i] - settles[i - 1]).toBeGreaterThanOrEqual(MEMBER_POLL_MS);
});

it("schedules nothing after unmount", async () => {
  calls.mockImplementation(slowReply(false));
  await act(async () => root.render(<Probe />));
  await act(async () => { await vi.advanceTimersByTimeAsync(LATENCY + 1); });
  expect(calls).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(calls).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  root = createRoot(document.createElement("div"));
});
