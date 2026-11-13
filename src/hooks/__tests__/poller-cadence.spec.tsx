// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTableMembership } from "../useTableMembership";
import { useTableBill } from "../useTableBill";
import { useSitting } from "../useSitting";
import { useFinishedOrders } from "../useOrderFinished";
import { useOnline } from "../useOnline";
import { useOfflineSales } from "../useOfflineSales";
import { useSlotReceiptOffer } from "../useSlotReceiptOffer";
import TableCalculator from "@/components/dashboard/TableCalculator";
import TrackerOverlay from "@/components/customer/TrackerOverlay";
import { rememberSitting } from "@/lib/table-binding";

const state = vi.hoisted(() => ({ t: (key: string) => key, router: { refresh: vi.fn() }, toast: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => state.t }));
vi.mock("next/navigation", () => ({ useRouter: () => state.router }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
vi.mock("@/hooks/useIsDesktop", () => ({ useIsDesktop: () => true }));
vi.mock("@/lib/offline-sales", async original => ({
  ...await original<typeof import("@/lib/offline-sales")>(),
  readHeld: () => [{ restaurantId: "restaurant", posRef: "sale", at: "2026-11-13" }],
  replayBody: () => ({}), markHeldError: vi.fn(),
}));

function Membership() { useTableMembership("restaurant", "table"); return null; }
function Bill() { useTableBill("restaurant", "table", true); return null; }
function Sitting() { useSitting("restaurant", "table"); return null; }
function Finished() { useFinishedOrders(["order"]); return null; }
function Online() { useOnline(); return null; }
function OfflineSales() { useOfflineSales("restaurant"); return null; }
function Receipt() { useSlotReceiptOffer({ restaurantId: "restaurant", tableId: "table", sessionId: "session" }); return null; }
function Calculator() { return <TableCalculator open tableId="table" tableLabel="1" currency="MXN" onClose={state.toast} onCollected={state.toast} />; }
function Tracker() { return <TrackerOverlay orderId="order" onClose={state.toast} />; }
const pollers = [
  { name: "useTableMembership", View: Membership, interval: 5_000, initial: 0 },
  { name: "useTableBill", View: Bill, interval: 10_000, initial: 0 },
  { name: "useSitting", View: Sitting, interval: 15_000, initial: 0 },
  { name: "useOrderFinished", View: Finished, interval: 15_000, initial: 0 },
  { name: "useOnline", View: Online, interval: 8_000, initial: 8_000 },
  { name: "useOfflineSales", View: OfflineSales, interval: 30_000, initial: 0 },
  { name: "useSlotReceiptOffer", View: Receipt, interval: 10_000, initial: 0 },
  { name: "TableCalculator", View: Calculator, interval: 5_000, initial: 0 },
  { name: "TrackerOverlay", View: Tracker, interval: 5_000, initial: 0 },
];
let root: Root;
let finish: (response: Response) => void;
const calls = vi.fn<typeof fetch>();
const reply = () => Response.json({ open: true, status: "received", id: "order", restaurant_id: "restaurant", table_id: "table", payments: [], splitOrderIds: [], orders: [] });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  localStorage.clear(); sessionStorage.clear(); rememberSitting("restaurant", "session", "other-table");
  calls.mockReset().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", calls); root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it.each(pollers)("$name waits a full interval after a slow read", async ({ View, interval, initial, name }) => {
  // Held sales retry while the browser says it is online; refusal keeps the sale held.
  if (name === "useOfflineSales") vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => root.render(<View />));
  if (initial) await advance(initial);
  expect(calls).toHaveBeenCalledTimes(1);
  await advance(interval * 2 + 100);
  expect(calls).toHaveBeenCalledTimes(1);
  await act(async () => finish(name === "useOnline" || name === "useOfflineSales" ? Response.json({}, { status: 503 }) : reply()));
  await advance(interval - 1);
  expect(calls).toHaveBeenCalledTimes(1);
  await advance(1);
  expect(calls).toHaveBeenCalledTimes(2);
  await advance(interval * 2 + 100);
  expect(calls).toHaveBeenCalledTimes(2);
  await act(async () => finish(name === "useOnline" || name === "useOfflineSales" ? Response.json({}, { status: 503 }) : reply()));
  await advance(interval - 1);
  expect(calls).toHaveBeenCalledTimes(2);
  await advance(1);
  expect(calls).toHaveBeenCalledTimes(3);
  await act(async () => root.unmount());
  await act(async () => finish(reply()));
  await advance(interval * 3);
  expect(calls).toHaveBeenCalledTimes(3);
});

it.each(pollers)("$name keeps its hidden-tab behaviour", async ({ View, interval, initial, name }) => {
  const paused = name === "useOrderFinished" || name === "useSlotReceiptOffer";
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  if (name === "useOfflineSales") vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await act(async () => root.render(<View />));
  await advance(initial + interval * 2);
  expect(calls).toHaveBeenCalledTimes(paused ? 0 : 1);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(calls).toHaveBeenCalledTimes(1);
});
