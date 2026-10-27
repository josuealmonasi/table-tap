// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openBills } from "@/lib/open-bills";
import type { Order } from "@/lib/types";

const { toast, refresh, state } = vi.hoisted(() => ({
  toast: vi.fn(), refresh: vi.fn(), state: { scanned: "order-a" as string | null },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }), useSearchParams: () => ({ get: () => state.scanned }),
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/hooks/useLiveOrders", () => ({ useLiveOrders: vi.fn() }));
vi.mock("@/components/layout/Breadcrumb", () => ({ default: () => null }));
vi.mock("../BillApprovals", () => ({ default: () => null }));
vi.mock("../BillDiscountDialog", () => ({ default: () => null }));
vi.mock("../loyalty/StampCard", () => ({ default: () => null }));
vi.mock("../OpenBillRow", () => ({ default: ({ bill }: { bill: { total: number } }) => <span>{bill.total}</span> }));
vi.mock("../ScanToCollect", () => ({ default: ({ onFound }: { onFound: (id: string) => void }) =>
  <button onClick={() => onFound("order-a")}>scan</button> }));
vi.mock("../SettleTableDialog", () => ({ default: ({ onClose }: { onClose: () => void }) =>
  <button data-collection onClick={onClose}>close collection</button> }));
import BillsPanel from "../BillsPanel";

let root: Root;
let container: HTMLDivElement;
async function render(total = 100) {
  const bills = openBills([{ id: "order-a", total, table_id: null, paid: false,
    status: "completed", items: [], created_at: "2026-10-27T12:00:00Z" } as unknown as Order]);
  await act(async () => root.render(<React.StrictMode><BillsPanel bills={bills} requests={[]} writeOffs={[]}
    restaurantId="r1" currency="MXN" canApprove canSettle canCollectInParts canDiscount
    canChargeAccount askedToPay={[]} /></React.StrictMode>));
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.scanned = "order-a"; toast.mockClear(); container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("consumes a URL scan once: a refreshed bill never reopens a dismissed collection", async () => {
  await render();
  expect(container.querySelector("[data-collection]")).not.toBeNull();
  await act(async () => container.querySelector<HTMLButtonElement>("[data-collection]")!.click());
  await render(75);
  expect(container.textContent).toContain("75");
  expect(container.querySelector("[data-collection]")).toBeNull();
  await act(async () => Array.from(container.querySelectorAll("button")).find(b => b.textContent === "scan")!.click());
  expect(container.querySelector("[data-collection]")).not.toBeNull();
});
it("reports a foreign or missing URL scan once, even after bill refreshes", async () => {
  state.scanned = "foreign-order";
  await render(); await render(75);
  expect(toast).toHaveBeenCalledTimes(1);
  expect(toast).toHaveBeenCalledWith("scan.notHere", "error");
  expect(container.querySelector("[data-collection]")).toBeNull();
});
it("accepts a new URL scan after navigation clears the previous one", async () => {
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>("[data-collection]")!.click());
  state.scanned = null; await render();
  state.scanned = "order-a"; await render();
  expect(container.querySelector("[data-collection]")).not.toBeNull();
});
