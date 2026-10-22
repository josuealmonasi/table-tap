import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountRow } from "@/lib/accounts-server";

interface Row { [key: string]: unknown }
const tables: Record<string, Row[]> = {};
const reads: { table: string; from: number; orders: string[] }[] = [];
let failedPage = -1;
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    const orders: string[] = [];
    let from = 0;
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => { filters.push(r => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push(r => r[k] !== v); return q; },
      not: (k: string) => { filters.push(r => r[k] != null); return q; },
      order: (k: string) => { orders.push(k); return q; },
      limit: () => q,
      range: (a: number) => { from = a; return q; },
      then: (resolve: (v: unknown) => unknown) => {
        reads.push({ table, from, orders });
        return Promise.resolve(table === "orders" && from === failedPage
          ? { data: null, error: { message: "page failed" } }
          : { data: (tables[table] ?? []).filter(r => filters.every(f => f(r))).slice(from, from + 1000), error: null })
          .then(resolve);
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
  tables.customer_accounts = [account as unknown as Row];
  reads.length = 0;
  failedPage = -1;
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
