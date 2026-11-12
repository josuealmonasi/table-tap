// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/**
 * History inherited the dashboard's 30 s refresh, a second read on a clock
 * keeping Pedidos from going quiet. It now re-reads when the live board sees
 * an order close, which is the only time history changes.
 */
const reads = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const q = { select: () => q, eq: () => q, in: () => q, order: () => q,
    range: async () => { reads(); return { data: [], count: 0, error: null }; } };
  return { from: () => q };
} }));
const { useOrderHistory } = await import("@/hooks/useOrderHistory");

let root: Root;
function Probe({ closed }: { closed: string }) {
  useOrderHistory("restaurant", closed);
  return null;
}
function render(closed: string) {
  // The dashboard's own defaults: every key refreshes every 30 s unless it says otherwise.
  return act(async () => root.render(
    <SWRConfig value={{ provider: () => new Map(), refreshInterval: 30_000, dedupingInterval: 0 }}>
      <Probe closed={closed} />
    </SWRConfig>,
  ));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  reads.mockReset();
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

it("does not re-read history on a timer", async () => {
  await render("a:completed");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(reads).toHaveBeenCalledTimes(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(reads).toHaveBeenCalledTimes(1);
});

it("re-reads once when the board sees another order close", async () => {
  await render("a:completed");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(reads).toHaveBeenCalledTimes(1);
  await render("a:completed,b:cancelled");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(reads).toHaveBeenCalledTimes(2);
  await render("a:completed,b:cancelled");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  expect(reads).toHaveBeenCalledTimes(2);
});
