import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: false, reads: [] as unknown[][] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  let start = 0;
  const tests: ((row: Record<string, unknown>) => boolean)[] = [];
  const q = {
    select: () => q, order: () => q,
    eq: (key: string, value: unknown) => { tests.push(row => row[key] === value); return q; },
    in: (key: string, values: unknown[]) => {
      tests.push(row => values.includes(key === "metadata->>account_checkout" ? (row.metadata as { account_checkout: string }).account_checkout : row[key]));
      return q;
    },
    range: (from: number) => { start = from; return q; },
    then: (done: (value: unknown) => unknown) => {
      s.reads.push([table, start]);
      return Promise.resolve({ data: (s.rows[table] ?? []).filter(row => tests.every(test => test(row))).slice(start, start + 1),
        error: s.fail ? { message: "unavailable" } : null }).then(done);
    },
  }; return q;
} }) }));
const { unresolvedAccounts } = await import("@/lib/account-checkout-state");
beforeEach(() => {
  s.fail = false; s.reads = []; s.rows = {
    account_checkouts: [
      { id: "old-open", account_id: "a", restaurant_id: "r", status: "open" },
      { id: "linked-open", account_id: "b", restaurant_id: "r", status: "expired" },
      { id: "closed", account_id: "c", restaurant_id: "r", status: "expired" },
      { id: "elsewhere", account_id: "c", restaurant_id: "other", status: "open" },
    ],
    diner_checkouts: [{ id: "attempt", restaurant_id: "r", status: "open", metadata: { account_checkout: "linked-open" } }],
  };
});
it("either unresolved row keeps the account unconfirmed, regardless of a local deadline", async () => {
  expect(await unresolvedAccounts("r", ["a", "b", "c"])).toEqual(new Set(["a", "b"]));
  expect(s.reads).toContainEqual(["account_checkouts", 3]);
});
it("a failed read cannot be displayed as no online payment", async () => {
  s.fail = true; await expect(unresolvedAccounts("r", ["a"])).rejects.toThrow("checkout pages");
});
