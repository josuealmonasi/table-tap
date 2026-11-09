// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { BoardRequest } from "@/lib/kitchen-ticket";
const state = vi.hoisted(() => ({ insert: null as null | ((p: { new: BoardRequest }) => void) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = { on: (_type: string, filter: { event: string }, cb: typeof state.insert) => {
    if (filter.event === "INSERT") state.insert = cb;
    return channel;
  }, subscribe: () => channel };
  return { auth: { getSession: async () => ({ data: { session: null } }) }, channel: () => channel, removeChannel: vi.fn() };
} }));
import { useServiceRequests } from "@/hooks/useServiceRequests";
let root: Root;
let latest: ReturnType<typeof useServiceRequests>;
const row = (id: string, created_at: string): BoardRequest => ({ id, created_at, restaurant_id: "r", table_label: "1", kind: "bill", status: "open" });
const initial = [row("boundary", "2026-10-29T04:00:00.000Z"), row("stale", "2026-10-29T03:59:59.999Z")];
function Probe({ failed = false }: { failed?: boolean }) {
  latest = useServiceRequests("r", failed ? [] : initial, false, failed);
  return null;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
it("expires visible and realtime calls by the same eight-hour rule without a reload", async () => {
  await act(async () => root.render(<Probe />));
  expect(latest.requests.map(r => r.id)).toEqual(["boundary"]);
  await act(async () => state.insert!({ new: row("late-stale", "2026-10-29T03:59:00Z") }));
  expect(latest.requests.map(r => r.id)).toEqual(["boundary"]);
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(latest.requests).toEqual([]);
});
it("keeps the last good calls after a failed server refresh", async () => {
  await act(async () => root.render(<Probe />));
  await act(async () => root.render(<Probe failed />));
  expect(latest.requests.map(r => r.id)).toEqual(["boundary"]);
});
