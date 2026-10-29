import { beforeEach, expect, it, vi } from "vitest";
import { SPLIT_SCREENS } from "../../../scripts/layout-paths.mjs";
const state = vi.hoisted(() => ({ cleanup: vi.fn(), members: vi.fn(), hold: vi.fn(), rpc: vi.fn(), fail: false, tables: [] as string[] }));
vi.mock("../../../scripts/split-slots-fixture.mjs", () => ({ splitSlotFixture: async () => ({
  scope: { restaurantId: "restaurant", tableId: "table", sessionId: "session" }, startBody: { ref: "ref" }, splitId: "split",
  body: () => ({ slots: [0], expectedCents: 3668, currency: "MXN", ref: "collection" }),
  cleanup: state.cleanup, hold: state.hold, rpc: state.rpc,
}) }));
vi.mock("../../../scripts/table-member-fixture.mjs", () => ({ memberFixture: () => ({
  cookieFor: async () => "tt-table-member=token", idFor: () => "member", cleanup: state.members,
}) }));
import { splitScreenFixture } from "../../../scripts/split-slot-screens.mjs";
function admin() {
  return { from: (table: string) => {
    state.tables.push(table);
    const q: Record<string, unknown> = {};
    for (const op of ["update", "delete", "eq", "insert"]) q[op] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null,
      error: state.fail && table === "service_requests" ? { message: "request failed" } : null }).then(resolve);
    return q;
  } };
}
beforeEach(() => {
  vi.clearAllMocks(); state.fail = false; state.tables = [];
  state.rpc.mockResolvedValue({ outcome: "collected", payment: "receipt", amount_cents: 3668, tip_cents: 0 }); state.hold.mockResolvedValue({ result: { outcome: "reserved" } });
});
it("registers the diner and both staff doors for every collector, never kitchen", () => {
  expect(SPLIT_SCREENS.filter(s => s.role === "diner")).toHaveLength(2);
  for (const role of ["owner", "manager", "waiter", "cashier"]) expect(SPLIT_SCREENS.filter(s => s.role === role && s.state === "parts").map(s => "door" in s ? s.door : undefined)).toEqual(["orders", "bills"]);
  for (const role of ["owner", "manager", "waiter", "cashier"]) {
    expect(SPLIT_SCREENS.filter(s => s.role === role && s.state === "receipt").map(s => "door" in s ? s.door : undefined)).toEqual(["orders", "bills"]);
    expect(SPLIT_SCREENS.some(s => s.role === role && s.state === "promotion")).toBe(true);
    expect(SPLIT_SCREENS.filter(s => s.role === role && s.state === "writeoff").map(s => "door" in s ? s.door : undefined)).toEqual(["orders", "bills"]);
  }
  expect(SPLIT_SCREENS.some(s => s.role === "kitchen")).toBe(false);
});
it("cleans only the private browser fixture's request, membership and money", async () => {
  const f = await splitScreenFixture(admin(), "restaurant");
  expect(state.rpc).toHaveBeenCalledWith("collect_split_slots_v1", expect.objectContaining({ p_split: "split", p_expected_cents: 3668 }));
  expect(state.hold).toHaveBeenCalledWith([1], "member");
  await f.cleanup(); expect(state.members).toHaveBeenCalledTimes(1); expect(state.cleanup).toHaveBeenCalledTimes(1);
});
it("still cleans money and memberships when deleting the private request fails", async () => {
  state.fail = true;
  await expect(splitScreenFixture(admin(), "restaurant")).rejects.toThrow("request failed");
  expect(state.members).toHaveBeenCalledTimes(1); expect(state.cleanup).toHaveBeenCalledTimes(1);
});

it("leaves no part held when opening the walkout confirmation", async () => {
  const f = await splitScreenFixture(admin(), "restaurant", true, false);
  expect(state.hold).not.toHaveBeenCalled();
  expect(state.rpc).toHaveBeenCalled();
  await f.cleanup();
});
