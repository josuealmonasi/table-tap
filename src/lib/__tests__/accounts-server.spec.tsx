import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@/lib/accounts-server";

interface Row { [key: string]: unknown }
const tables: Record<string, Row[]> = {};
const reads: { table: string; from: number; orders: string[] }[] = [];
let failedPage = -1;
let failedTable: string | null = null;
let holdOrders: Promise<void> | undefined;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: string[] = [];
    let from = 0;
    let limit = 1000;
    const q = {
      select: () => q,
      returns: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      in: (k: string, values: unknown[]) => { filters.push(r => values.includes(r[k])); return q; },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      not: (k: string) => { filters.push(r => r[k] != null); return q; },
      order: (k: string) => { orders.push(k); return q; },
      limit: (value: number) => { limit = value; return q; },
      range: (a: number) => { from = a; return q; },
      then: (resolve: (v: unknown) => unknown) => {
        reads.push({ table, from, orders });
        const result = table === failedTable || (table === "orders" && from === failedPage)
          ? { data: null, error: { message: "page failed" } }
          : { data: (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(from, from + limit), error: null };
        return Promise.resolve(table === "orders" ? holdOrders : undefined).then(() => result).then(resolve);
      },
    };
    return q;
  } }),
}));
const { statementOf, listAccounts } = await import("@/lib/accounts-server");
const account = { id: "a1", restaurant_id: "r1", credit_limit: 200000 } as AccountRow;
const charge = (id: string, written_off = false): Row => ({
  id, account_id: "a1", restaurant_id: "r1", total: 100, paid: false, written_off,
  status: "completed", created_at: "2026-10-01T12:00:00Z", charged_at: null, charged_by: "ana", items: [],
});
beforeEach(() => {
  tables.orders = [];
  tables.payments = [];
  tables.order_adjustments = [];
  tables.refund_operations = [];
  tables.customer_accounts = [account as unknown as Row];
  reads.length = 0;
  failedPage = -1;
  failedTable = null;
  holdOrders = undefined;
});

it.each([null, "orders", "payments", "refund_operations", "order_adjustments"])("starts all statement reads together and preserves history or failure for %s", async table => {
  const at = "2026-10-01T18:00:00Z";
  const order = { ...charge("food"), total: 70, currency: "MXN", created_at: at, table_label: "Patio" };
  tables.orders = [order];
  tables.payments = Array.from({ length: 21 }, () => ({ restaurant_id: "r1", account_id: "a1", amount: "15", tip: "2", currency: "MXN", method: "card", created_at: at }));
  tables.refund_operations = [{ restaurant_id: "r1", "order_adjustments.orders.account_id": "a1", id: "return", amount: "3", currency: "MXN", status: "pending", created_at: at }];
  tables.order_adjustments = [{ id: "credit", restaurant_id: "r1", "orders.account_id": "a1", kind: "account_credit", orders: order,
    order_id: "food", resulting_total: 70, forgiven: "30", currency: "MXN", created_at: at, actor: "manager", reason: "error", note: "Duplicate dish" }];
  failedTable = table;
  let release!: () => void;
  holdOrders = new Promise(resolve => { release = resolve; });
  const pending = statementOf(account, "Asia/Tokyo").then(statement => ({ statement }), error => ({ error: (error as Error).message }));
  await new Promise<void>(resolve => setImmediate(resolve));
  const started = reads.filter(r => r.from === 0).map(r => r.table).sort();
  release();
  const result = await pending;
  await new Promise<void>(resolve => setImmediate(resolve));
  const names: Record<string, string> = { orders: "orders", payments: "payments", refund_operations: "returns", order_adjustments: "credits" };
  expect({ started, result }).toEqual({ started: ["order_adjustments", "orders", "payments", "refund_operations"],
    result: table ? { error: `Could not read the account's ${names[table]}: page failed` } : { statement: {
      currency: "MXN", balances: [{ currency: "MXN", amount: 70 }], owed: 70, chargedBy: { food: "ana" },
      days: [{ day: "2026-10-02", currency: "MXN", total: 70, charges: [{ orderId: "food", currency: "MXN", at, tableLabel: "Patio", lines: [], total: 70, creditable: true,
        credits: [{ at, amount: 30, currency: "MXN", actor: "manager", reason: "error", note: "Duplicate dish" }] }] }],
      payments: Array.from({ length: 20 }, () => ({ at, amount: 15, tip: 2, currency: "MXN", method: "card" })),
      returns: [{ id: "return", amount: 3, currency: "MXN", status: "pending", created_at: at }],
    } },
  });
});
describe("account statement and list agree about debt", () => {
  it("S21 carries a US$100 debt and separates it from MX$100", async () => {
    tables.orders = [{ ...charge("usd"), currency: "USD" }];
    expect(await statementOf(account)).toMatchObject({ currency: "USD", owed: 100 });
    tables.orders.push({ ...charge("mxn"), currency: "MXN" });
    const statement = await statementOf(account);
    expect(statement).toMatchObject({ currency: null, owed: 0, balances: [{ currency: "USD", amount: 100 }, { currency: "MXN", amount: 100 }] });
    expect(statement.days.map(d => [d.currency,d.total])).toEqual([["USD",100],["MXN",100]]);
    expect((await listAccounts("r1"))[0]).toMatchObject({ owed: 0, balances: statement.balances });
  });
  it("counts all 1001 charges, with a unique page order", async () => {
    tables.orders = Array.from({ length: 1001 }, (_, i) => charge(String(i)));
    expect((await statementOf(account)).owed).toBe(100100);
    expect(reads.filter(r => r.table === "orders").map(r => r.from)).toEqual([0, 1000, 1001]);
    expect(reads.filter(r => r.table === "orders").every(r => r.orders.includes("id"))).toBe(true);
  });
  it("refuses an incomplete statement when a later page fails", async () => {
    tables.orders = Array.from({ length: 1001 }, (_, i) => charge(String(i)));
    failedPage = 1000;
    await expect(statementOf(account)).rejects.toThrow("page failed");
  });
  it("leaves waived debt out of both the statement and the list", async () => {
    tables.orders = [charge("food"), charge("waived", true)];
    expect((await statementOf(account)).owed).toBe(100);
    expect((await listAccounts("r1"))[0].owed).toBe(100);
  });
});

it("keeps credits under unpaid, fully forgiven and subsequently collected orders without recreating debt", async () => {
  tables.orders = [{ ...charge("partial"), total: 70, currency: "MXN" },
    { ...charge("full", true), total: 0, currency: "MXN" }, { ...charge("collected"), total: 70, paid: true, currency: "MXN" }];
  tables.order_adjustments = tables.orders.map(o => ({ id: `credit-${o.id}`, order_id: o.id, restaurant_id: "r1", kind: "account_credit",
    "orders.account_id": "a1", orders: o, resulting_total: o.total, created_at: "2026-11-10T12:00:00Z", forgiven: o.id === "full" ? 100 : 30,
    currency: "MXN", actor: "manager@example.com", reason: "error", note: "Duplicate dish" }));
  const statement = await statementOf(account);
  expect(statement.owed).toBe(70);
  expect((await listAccounts("r1"))[0].owed).toBe(70);
  const charges = statement.days.flatMap(d => d.charges);
  expect(charges).toHaveLength(3);
  expect(charges.find(c => c.orderId === "partial")).toMatchObject({ total: 70, creditable: true, credits: [{ amount: 30, actor: "manager@example.com", reason: "error" }] });
  expect(charges.find(c => c.orderId === "full")).toMatchObject({ total: 0, creditable: false, credits: [{ amount: 100 }] });
  expect(charges.find(c => c.orderId === "collected")).toMatchObject({ total: 0, creditable: false, credits: [{ amount: 30 }] });
});

it("fails closed when a credit races the earlier unpaid-order read", async () => {
  const o = { ...charge("race"), currency: "MXN", total: 100 };
  tables.orders = [o];
  tables.order_adjustments = [{ id: "credit", order_id: "race", restaurant_id: "r1", kind: "account_credit", "orders.account_id": "a1",
    orders: o, resulting_total: 70, created_at: "2026-11-10T12:00:00Z", forgiven: 30, currency: "MXN", actor: "manager", reason: "error" }];
  await expect(statementOf(account)).rejects.toThrow("changed while reading");
});

it("groups mixed-currency balances and last charges with linear account-id reads", async () => {
  tables.customer_accounts = Array.from({ length: 20 }, (_, i) => ({ ...account, id: `a${i}` }));
  let accountIdReads = 0;
  tables.orders = [
    { ...charge("usd"), currency: "USD", total: 0.105, charged_at: "2026-10-03T12:00:00Z" },
    { ...charge("mxn"), currency: "MXN", total: "7.25" },
    { ...charge("usd-2"), currency: "USD", total: 0.105 },
  ].map(row => Object.defineProperty(row, "account_id", { get: () => { accountIdReads++; return "a1"; } }));
  const result = await listAccounts("r1");
  expect({ linear: accountIdReads <= tables.orders.length * 5,
    summaries: result.map(({ id, owed, currency, balances, lastChargeAt, payingOnline }) => ({ id, owed, currency, balances, lastChargeAt, payingOnline })),
  }).toEqual({ linear: true, summaries: tables.customer_accounts.map(({ id }) => ({ id, owed: 0, currency: null,
    balances: id === "a1" ? [{ currency: "USD", amount: 0.22 }, { currency: "MXN", amount: 7.25 }] : [],
    lastChargeAt: id === "a1" ? "2026-10-03T12:00:00Z" : null, payingOnline: false,
  })) });
});
