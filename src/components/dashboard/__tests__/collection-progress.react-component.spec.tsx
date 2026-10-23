import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { pendingHarness } from "@/lib/__tests__/pending-ui-harness";
import type { OpenBill } from "@/lib/open-bills";
import type { BoardRequest } from "@/lib/kitchen-ticket";

const state = vi.hoisted(() => ({
  ui: null as unknown as ReturnType<typeof pendingHarness>,
  dialog: null as null | { onSettled: () => void; onClose: () => void },
  requests: [] as BoardRequest[], markDone: vi.fn(), refresh: vi.fn(), finish: () => {},
}));
vi.mock("react", async original => ({ ...await original<typeof React>(),
  useState: (v: unknown) => state.ui.useState(v), useRef: (v: unknown) => state.ui.useRef(v),
  useEffect: vi.fn(), useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
  useTransition: () => {
    const [pending, setPending] = state.ui.useState(false) as [boolean, (value: boolean) => void];
    state.finish = () => setPending(false);
    return [pending, (fn: () => void) => { setPending(true); fn(); }];
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/hooks/useLiveOrders", () => ({ useLiveOrders: vi.fn() }));
vi.mock("@/hooks/usePendingPhones", () => ({ usePendingPhones: () => ({ pending: [] }) }));
vi.mock("@/hooks/useServiceRequests", () => ({ useServiceRequests: () => ({ requests: state.requests, markDone: state.markDone }) }));
vi.mock("@/components/dashboard/SettleTableDialog", () => ({ default: (props: typeof state.dialog) => { state.dialog = props; return null; } }));
vi.mock("@/components/dashboard/BillDiscountDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/BillApprovals", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ScanToCollect", () => ({ default: () => null }));
vi.mock("@/components/dashboard/loyalty/StampCard", () => ({ default: () => null }));
vi.mock("@/components/layout/Breadcrumb", () => ({ default: () => null }));

import BillsPanel from "@/components/dashboard/BillsPanel";
import ServiceRequestsBar from "@/components/dashboard/ServiceRequestsBar";
const bill = (table: string): OpenBill => ({
  key: `${table}:MXN`, tableId: table, tableLabel: table, currency: "MXN", code: null,
  customerName: null, orderIds: [`order-${table}`], items: [], total: 100,
  discount: 0, discounted: false, since: "2026-10-22T12:00:00Z",
});
beforeEach(() => {
  vi.stubGlobal("React", React); state.ui = pendingHarness(); state.dialog = null;
  state.requests = []; vi.clearAllMocks();
});
const click = (label: string) => state.ui.all("button").find(n => n.text === label)!.props.onClick!();

it("keeps the Pedidos collection request after a part payment and clears it only from server truth", () => {
  state.requests = [{ id: "request", table_id: "table", table_label: "1", kind: "pay", status: "open", created_at: "2026-10-22" } as BoardRequest];
  const refresh = vi.fn();
  state.ui.render(() => <ServiceRequestsBar restaurantId="r" initialRequests={state.requests} currency="MXN" canSettle canApprove={false} onSettled={refresh} />);
  click("settle.open"); state.ui.render(); state.dialog!.onSettled(); state.dialog!.onClose(); state.ui.render();
  expect(state.markDone).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledOnce();
  expect(state.ui.all("button").find(n => n.text === "settle.updatingBalance")?.disabled).toBe(true);
  state.finish(); state.ui.render();
  expect(state.ui.all("button").find(n => n.text === "settle.open")?.disabled).toBe(false);
  state.requests = []; state.ui.render();
  expect(state.ui.all("button")).toHaveLength(0);
});

it.each([false, true])("locks both bill-row actions until the server refresh finishes (fully paid: %s)", fullyPaid => {
  let bills = [bill("1"), bill("2")];
  state.ui.render(() => <BillsPanel bills={bills} requests={[]} writeOffs={[]} currency="MXN" restaurantId="r" canApprove={false} canSettle canCollectInParts canDiscount={false} canChargeAccount={false} askedToPay={[]} />);
  click("dash.collect"); state.ui.render(); state.dialog!.onSettled(); state.dialog!.onClose(); state.ui.render();
  const mains = state.ui.all("button").filter(n => n.props.className === "tt-bill-open-main");
  expect(mains.map(n => n.disabled)).toEqual([true, false]);
  expect(state.ui.all("button").find(n => n.text === "settle.updatingBalance")?.disabled).toBe(true);
  expect(state.refresh).toHaveBeenCalledOnce();
  bills = fullyPaid ? [bills[1]] : [{ ...bills[0], total: 60, collected: 40 }, bills[1]];
  state.finish(); state.ui.render();
  expect(state.ui.text()).not.toContain("settle.updatingBalance");
  expect(state.ui.all("button").filter(n => n.text === "dash.collect")).toHaveLength(fullyPaid ? 1 : 2);
  expect(state.ui.all("button").every(n => !n.disabled)).toBe(true);
});
