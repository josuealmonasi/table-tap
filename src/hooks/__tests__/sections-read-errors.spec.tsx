// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, type State } from "swr";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { from, toast } = vi.hoisted(() => ({ from: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: "en" }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => toast }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ useConfirm: () => vi.fn() }));
vi.mock("@/components/layout/Breadcrumb", () => ({ default: () => null }));
vi.mock("@/components/ui/AddInDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/OrderDetailDialog", () => ({ default: () => null }));
import { useStaff } from "../useStaff";
import OrderHistory from "@/components/dashboard/OrderHistory";
import StaffPanel from "@/components/dashboard/staff/StaffPanel";

interface Result { data: unknown; count?: number | null; error: { message: string } | null }
function queue(...results: Result[]) {
  for (const result of results) from.mockReturnValueOnce(Object.assign(Promise.resolve(result), {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(), range: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(), lte: vi.fn().mockReturnThis(),
  }));
}
const failed: Result = { data: null, count: null, error: { message: "unavailable" } };
const member = { id: "s1", user_id: "u1", email: "staff@example.com", role: "waiter", created_at: "2026-10-27" };
const staff = { data: [member], error: null };
const profiles = { data: [{ user_id: "u1", full_name: "Ana" }], error: null };
const order = { id: "a1234567-0000-0000-0000-000000000000", total: 100, currency: "MXN", status: "completed", items: [], created_at: "2026-10-27" };
let root: Root;
let container: HTMLDivElement;
let cache: Map<string, State>;
let latest: ReturnType<typeof useStaff> & { error?: unknown; refresh?: () => Promise<unknown> };
function StaffHarness({ restaurantId = "r1" }: { restaurantId?: string }) {
  latest = useStaff(restaurantId);
  return null;
}
async function render(child: React.ReactNode) {
  await act(async () => root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0,
    shouldRetryOnError: false }} >{child}</SWRConfig>));
}
async function retry() {
  const button = Array.from(container.querySelectorAll("button")).find(b => b.textContent === "settle.retry");
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  from.mockReset(); toast.mockClear(); cache = new Map();
  container = document.createElement("div"); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });

it("history shows an error and retry rather than no sales on an initial failed read", async () => {
  queue(failed);
  await render(<OrderHistory restaurantId="r1" currency="MXN" />);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("orders.noPast");
  queue({ data: [order], count: 1, error: null }); await retry();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("ORD-A123");
});
it("history keeps the last rows and total when the next page fails, then retries that page", async () => {
  queue({ data: [order], count: 11, error: null });
  await render(<OrderHistory restaurantId="r1" currency="MXN" />);
  queue(failed);
  await act(async () => Array.from(container.querySelectorAll("button")).find(b => b.textContent === "dash.older")!.click());
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).toContain("ORD-A123");
  expect(container.textContent).not.toContain("orders.noPast");
  queue({ data: [{ ...order, id: "b1234567-0000-0000-0000-000000000000" }], count: 11, error: null }); await retry();
  expect(container.textContent).toContain("ORD-B123");
  expect(from.mock.results.at(-1)!.value.range).toHaveBeenCalledWith(10, 19);
});
it.each(["staff", "profiles"])("a failed %s read is an error with retry, never an empty team", async table => {
  queue(...(table === "staff" ? [failed] : [staff, failed]));
  await render(<StaffPanel restaurantId="r1" />);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain("dash.noStaff");
  queue(staff, profiles); await retry();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain("Ana");
});
it.each(["staff", "profiles"])("retains the last successful team and names after a failed %s refresh", async table => {
  queue(staff, profiles); await render(<StaffHarness />);
  expect(latest.members[0].full_name).toBe("Ana");
  queue(...(table === "staff" ? [failed] : [staff, failed]));
  await act(async () => { await latest.refresh?.(); });
  expect(latest.error).toBeTruthy();
  expect(latest.members[0].full_name).toBe("Ana");
  queue(staff, profiles); await act(async () => { await latest.refresh?.(); });
  expect(latest.error).toBeFalsy();
});
it("keeps an invitation successful when only the follow-up list read fails", async () => {
  queue(staff, profiles); await render(<StaffHarness />);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  queue(failed);
  let added = false;
  await act(async () => { added = await latest.addMember("new@example.com", "waiter"); });
  expect(added).toBe(true);
  expect(latest.error).toBeTruthy();
  expect(latest.members[0].email).toBe("staff@example.com");
});
it("never carries another restaurant's previous history rows into a failed read", async () => {
  queue({ data: [order], count: 1, error: null });
  await render(<OrderHistory restaurantId="r1" currency="MXN" />);
  queue(failed); await render(<OrderHistory restaurantId="r2" currency="USD" />);
  expect(container.textContent).not.toContain("ORD-A123");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it("an actual empty team stays distinct from failure and skips the profile query", async () => {
  queue({ data: [], error: null }); await render(<StaffPanel restaurantId="r1" />);
  expect(container.textContent).toContain("dash.noStaff");
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(from).toHaveBeenCalledTimes(1);
});

it.each(["history", "staff"])("handles a rejected %s read as an error that can be retried", async screen => {
  from.mockImplementationOnce(() => { throw new TypeError("offline"); });
  await render(screen === "history" ? <OrderHistory restaurantId="r1" currency="MXN" /> : <StaffPanel restaurantId="r1" />);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.textContent).not.toContain(screen === "history" ? "orders.noPast" : "dash.noStaff");
  queue({ data: [], count: 0, error: null }); await retry();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.textContent).toContain(screen === "history" ? "orders.noPast" : "dash.noStaff");
});
it("never carries another restaurant's staff or names into a failed read", async () => {
  queue(staff, profiles); await render(<StaffHarness />);
  queue(failed); await render(<StaffHarness restaurantId="r2" />);
  expect(latest.members).toEqual([]);
  expect(latest.error).toBeTruthy();
});
it("keeps confirmed role changes and removals in the staff cache", async () => {
  queue(staff, profiles); await render(<StaffHarness />);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  await act(async () => latest.updateRole("s1", "cashier"));
  expect(latest.members[0].role).toBe("cashier");
  await act(async () => latest.removeMember("s1"));
  expect(latest.members).toEqual([]);
  expect(latest.busy).toBe(false);
});
