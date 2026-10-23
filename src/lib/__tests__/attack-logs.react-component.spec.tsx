import { beforeEach, expect, it, vi } from "vitest";
import { trackCollectionLogs, clearCollectionLogs } from "../../../scripts/attack-collection-logs.mjs";

const from = vi.fn();
const admin = { from };
const context = { restaurantId: "restaurant", actor: "waiter@example.com", amount: 200 };
let captured: Set<string>;
function answer(ids: string[], error: object | null = null) {
  const query = Object.assign(Promise.resolve({ data: ids.map(id => ({ id })), error }), {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(), delete: vi.fn().mockReturnThis(),
  });
  from.mockReturnValueOnce(query);
  return query;
}
beforeEach(() => { vi.resetAllMocks(); captured = new Set(); });

it("captures only the new row and returns the operation's result without retrying it", async () => {
  const first = answer(["old"]), last = answer(["old", "new"]);
  const operation = vi.fn().mockResolvedValue({ status: 200 });
  expect(await trackCollectionLogs(admin, context, captured, operation)).toEqual({ status: 200 });
  expect(operation).toHaveBeenCalledOnce();
  expect([...captured]).toEqual(["new"]);
  for (const query of [first, last]) {
    expect(query.eq).toHaveBeenCalledWith("restaurant_id", context.restaurantId);
    expect(query.eq).toHaveBeenCalledWith("actor_email", context.actor);
    expect(query.eq).toHaveBeenCalledWith("detail", "amount=200.00 tip=0.00 currency=MXN method=cash");
    expect(query.delete).not.toHaveBeenCalled();
  }
});

it("retains the exact new row for teardown after a lost response", async () => {
  answer([]); answer(["landed"]);
  const operation = vi.fn().mockRejectedValue(new Error("lost response"));
  await expect(trackCollectionLogs(admin, context, captured, operation)).rejects.toThrow("lost response");
  expect([...captured]).toEqual(["landed"]);
  expect(operation).toHaveBeenCalledOnce();
});

it.each([{ ids: [] as string[] }, { ids: ["one", "two"] }])("refuses missing or ambiguous successful collection logs: $ids", async ({ ids }) => {
  answer([]); answer(ids);
  await expect(trackCollectionLogs(admin, context, captured, async () => 200)).rejects.toThrow();
  expect(captured.size).toBe(0);
});

it("does not start a money request without a successful baseline read", async () => {
  answer([], { message: "offline" });
  const operation = vi.fn();
  await expect(trackCollectionLogs(admin, context, captured, operation)).rejects.toThrow("Could not read");
  expect(operation).not.toHaveBeenCalled();
});

it("does not treat a failed final read as no new activity", async () => {
  answer([]); answer([], { message: "offline" });
  await expect(trackCollectionLogs(admin, context, captured, async () => 200)).rejects.toThrow("Could not read");
});

it("deletes only captured IDs in the fixture restaurant", async () => {
  captured.add("new");
  const query = answer(["new"]);
  await clearCollectionLogs(admin, context.restaurantId, captured);
  expect(query.eq).toHaveBeenCalledWith("restaurant_id", context.restaurantId);
  expect(query.in).toHaveBeenCalledWith("id", ["new"]);
  expect(captured.size).toBe(0);
});

it("makes no delete without captured rows", async () => {
  await clearCollectionLogs(admin, context.restaurantId, captured);
  expect(from).not.toHaveBeenCalled();
});

it.each(["error", "missing", "foreign"])("does not claim cleanup succeeded after %s", async failure => {
  captured.add("new");
  answer(failure === "missing" ? [] : [failure === "foreign" ? "other" : "new"], failure === "error" ? {} : null);
  await expect(clearCollectionLogs(admin, context.restaurantId, captured)).rejects.toThrow("Could not remove");
  expect([...captured]).toEqual(["new"]);
});
