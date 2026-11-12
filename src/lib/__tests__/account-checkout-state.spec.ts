import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, fail: false, reads: [] as unknown[][],
  holds: {} as Record<string, Promise<void>>, active: 0, maxActive: 0,
}));
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
    then: async (done: (value: unknown) => unknown) => {
      s.reads.push([table, start]);
      s.active++;
      s.maxActive = Math.max(s.maxActive, s.active);
      if (start === 0) await s.holds[table];
      s.active--;
      return Promise.resolve({ data: (s.rows[table] ?? []).filter(row => tests.every(test => test(row))).slice(start, start + 1),
        error: s.fail ? { message: "unavailable" } : null }).then(done);
    },
  }; return q;
} }) }));
const { unresolvedAccounts } = await import("@/lib/account-checkout-state");
beforeEach(() => {
  s.holds = {}; s.active = 0; s.maxActive = 0;
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

it("starts four independent batches in both stages and keeps every capped page and expired link", async () => {
  const ids = Array.from({ length: 601 }, (_, i) => `a${i}`);
  s.rows.account_checkouts = ids.map(account_id => ({ id: `c-${account_id}`, account_id, restaurant_id: "r", status: "expired" }));
  s.rows.diner_checkouts = ids.map(id => ({ id: `d-${id}`, restaurant_id: "r", status: "open", metadata: { account_checkout: `c-${id}` } }));
  let releaseAccounts!: () => void;
  let releaseAttempts!: () => void;
  s.holds.account_checkouts = new Promise(resolve => { releaseAccounts = resolve; });
  s.holds.diner_checkouts = new Promise(resolve => { releaseAttempts = resolve; });
  const pending = unresolvedAccounts("r", [...ids, ids[0]]);
  // Drain runnable microtasks while first-page reads remain blocked.
  await new Promise<void>(resolve => setImmediate(resolve));
  const accountsStarted = s.reads.length;
  releaseAccounts();
  await new Promise<void>(resolve => setImmediate(resolve));
  const attemptsStarted = s.reads.filter(([table]) => table === "diner_checkouts").length;
  releaseAttempts();
  const result = await pending;
  expect({ accountsStarted, attemptsStarted, maxActive: s.maxActive, accounts: [...result],
    pages: s.reads.filter(([, start]) => start === 150).length,
  }).toEqual({ accountsStarted: 4, attemptsStarted: 4, maxActive: 4, accounts: ids, pages: 8 });
});
