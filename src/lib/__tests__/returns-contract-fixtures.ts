import { vi } from "vitest";
import { NextRequest } from "next/server";

export const ORDER = "11111111-1111-4111-8111-111111111111";
export const REF = "22222222-2222-4222-8222-222222222222";
export const REF_TWO = "33333333-3333-4333-8333-333333333333";
export interface Row { [key: string]: unknown }
export interface Components { total: number; tip: number; service_fee: number }

/** Scripted RPC answers are the SQL boundary, not a PostgreSQL simulation. */
export function returnFixture() {
  const tables: Record<string, Row[]> = {
    orders: [{ id: ORDER, restaurant_id: "r1", paid: true, status: "completed", written_off: false,
      account_id: null, total: 80, tip: 10, service_fee: 0, currency: "MXN" }],
    order_adjustments: [], refund_operations: [], refund_allocations: [], payments: [], user_logs: [],
  };
  const rpc = vi.fn<(name: string, args: Row) => Promise<{ data: unknown; error: null }>>(async () => ({ data: null, error: null }));
  const from = vi.fn((table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let start = 0; let end = Infinity;
    const rows = () => (tables[table] ?? []).filter(row => filters.every(f => f(row))).slice(start, end + 1);
    const q = {
      select: () => q, order: () => q,
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q; },
      in: (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return q; },
      lt: (key: string, value: string) => { filters.push(row => String(row[key]) < value); return q; },
      neq: (key: string, value: unknown) => { filters.push(row => row[key] !== value); return q; },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return q; },
      gte: (key: string, value: string) => { filters.push(row => String(row[key]) >= value); return q; },
      lte: (key: string, value: string) => { filters.push(row => String(row[key]) <= value); return q; },
      range: (a: number, b: number) => { start = a; end = b; return q; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (resolve: (value: { data: Row[]; error: null }) => unknown) => Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return q;
  });
  return { tables, rpc, from };
}

export function returnRequest(over: Row = {}): NextRequest {
  return new NextRequest("https://test/api/order-refunds", { method: "POST", body: JSON.stringify({
    action: "prepare", orderId: ORDER, amountCents: 5000, reason: "quality", note: "Cold meal", ref: REF,
    expected: { totalCents: 8000, tipCents: 1000, serviceCents: 0 }, ...over,
  }) });
}

export function prepared(previous: Components, resulting: Components, operations: Row[], over: Row = {}): Row {
  return { outcome: "prepared", adjustment: "adjustment-1", replay: false,
    amount_cents: Math.round((previous.total - resulting.total) * 100), previous, resulting, operations, ...over };
}

export function operation(id: string, source: string, amount: number, tip = 0): Row {
  return { id, adjustment_id: "adjustment-1", source, amount, tip, currency: "MXN", status: "pending",
    original_collector: source === "cash" ? "cashier" : null };
}
