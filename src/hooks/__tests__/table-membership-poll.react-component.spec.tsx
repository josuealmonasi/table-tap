// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTableMembership } from "@/hooks/useTableMembership";
import { MEMBER_POLL_MS } from "@/lib/poll";

const calls = vi.fn<typeof fetch>();
const phone = { id: "phone", tableId: "table", tableLabel: "3", createdAt: "2026-10-23" };
let root: Root;
let latest: ReturnType<typeof useTableMembership>;
function Probe({ table, restaurant }: { table: string | null; restaurant: string }): React.ReactNode {
  latest = useTableMembership(restaurant, table);
  return null;
}
const reply = (changes: Record<string, unknown> = {}) => Response.json({
  status: "approved", sessionId: "sitting", diner: "me", pass: "visit-pass", pending: [phone], ...changes,
});
async function render(table: string | null = "table", restaurant = "restaurant"): Promise<void> {
  await act(async () => root.render(<Probe table={table} restaurant={restaurant} />));
}
async function advance(ms = MEMBER_POLL_MS): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", calls);
  calls.mockReset().mockImplementation(async () => reply());
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  localStorage.clear();
  const container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("uses one admission POST per interval with no second pending-list request", async () => {
  await render();
  expect(latest.pending).toEqual([phone]);
  expect(calls).toHaveBeenCalledOnce();
  await advance(60_000);
  expect(calls).toHaveBeenCalledTimes(13); // Initial check plus twelve regular polls.
  for (const [url, options] of calls.mock.calls) {
    expect(url).toBe("/api/table-membership");
    expect(options?.method).toBe("POST");
  }
});

it("retains the same sitting's last good list on a secondary read failure, then recovers", async () => {
  await render();
  calls.mockImplementation(async () => reply({ pending: null }));
  await advance();
  expect(latest.state?.status).toBe("approved");
  expect(latest.pending).toEqual([phone]);
  expect(latest.error).toBe(false);
  expect(latest.pendingError).toBe(true);
  calls.mockImplementation(async () => reply({ pending: [] }));
  await advance();
  expect(latest.pending).toEqual([]);
  expect(latest.pendingError).toBe(false);
});

it("never carries requests from the previous sitting through a failed list read", async () => {
  await render();
  calls.mockImplementation(async () => reply({ sessionId: "new-sitting", pending: null }));
  await advance();
  expect(latest.pending).toEqual([]);
  expect(latest.state?.sessionId).toBe("new-sitting");
  expect(latest.pendingError).toBe(true);
});

it.each(["empty", "pending", "rejected"])("clears approved requests when admission becomes %s", async status => {
  await render();
  calls.mockImplementation(async () => reply({ status, pending: [] }));
  await advance();
  expect(latest.state?.status).toBe(status);
  expect(latest.pending).toEqual([]);
  expect(latest.pendingError).toBe(false);
});

it("retains last-good admission after a refused poll and retries on the regular interval", async () => {
  await render();
  calls.mockResolvedValueOnce(Response.json({}, { status: 503 }));
  await advance();
  expect(latest.error).toBe(true);
  expect(latest.state?.status).toBe("approved");
  expect(latest.pending).toEqual([phone]);
  await advance();
  expect(latest.error).toBe(false);
  expect(calls).toHaveBeenCalledTimes(3);
});

it("does not overlap slow polls or replay them after teardown", async () => {
  let finish!: (response: Response) => void;
  calls.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await render();
  await advance(15_000);
  expect(calls).toHaveBeenCalledOnce();
  await render(null);
  await act(async () => finish(reply()));
  await advance(15_000);
  expect(calls).toHaveBeenCalledOnce();
  expect(latest.state).toBeNull();
  expect(latest.pending).toEqual([]);
});

it("keeps refreshing admission on visibility and after an approval decision", async () => {
  await render();
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => latest.refresh());
  expect(calls).toHaveBeenCalledTimes(3);
});

it.each(["table", "restaurant"])("hides the previous %s before a new poll and ignores its late answer", async changed => {
  await render();
  let finish!: (response: Response) => void;
  calls.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await advance();
  const table = changed === "table" ? "new-table" : "table";
  const restaurant = changed === "restaurant" ? "new-restaurant" : "restaurant";
  await render(table, restaurant);
  expect(latest.state).toBeNull();
  expect(latest.pending).toEqual([]);
  calls.mockImplementation(async () => reply({ sessionId: "new-sitting", pending: [] }));
  await act(async () => finish(reply()));
  expect(latest.state?.sessionId).toBe("new-sitting");
  expect(latest.pending).toEqual([]);
});

it("does not poll without a table", async () => {
  await render(null);
  await advance(60_000);
  expect(calls).not.toHaveBeenCalled();
});
