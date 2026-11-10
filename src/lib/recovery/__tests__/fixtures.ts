import { vi } from "vitest";
import type { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";

export interface Row { [key: string]: unknown }
export const old = "2026-10-20T00:00:00.000Z";

/** Scripted SQL outcomes keep these tests away from the shared database. */
export function fixture() {
  const tables: Record<string, Row[]> = {};
  const errors: Record<string, string> = {};
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const from = vi.fn((table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let limit = Infinity;
    let offset = 0;
    const sort: string[] = [];
    const value = (row: Row, key: string): unknown => key.split(".").reduce<unknown>((v, k) => (v as Row)?.[k], row);
    const all = () => (tables[table] ?? []).filter(r => filters.every(f => f(r)))
      .sort((a, b) => sort.map(key => String(value(a, key)).localeCompare(String(value(b, key)))).find(n => n !== 0) ?? 0);
    const result = () => ({ data: all().slice(offset, offset + limit), count: all().length,
      error: errors[table] ? { message: errors[table] } : null });
    const q = {
      returns: () => q,
      select: (...args: unknown[]) => { calls.push({ table, method: "select", args }); return q; },
      eq: (k: string, v: unknown) => { filters.push(r => value(r, k) === v); return q; },
      in: (k: string, v: unknown[]) => { filters.push(r => v.includes(value(r, k))); return q; },
      is: (k: string, v: unknown) => { filters.push(r => (value(r, k) ?? null) === v); return q; },
      not: (k: string) => { filters.push(r => value(r, k) != null); return q; },
      or: () => { filters.push(r => r.provider_status == null || ["pending", "requires_action"].includes(String(r.provider_status))); return q; },
      lt: (k: string, v: string) => { filters.push(r => String(value(r, k)) < v); return q; },
      order: (k: string) => { sort.push(k); return q; },
      range: (from: number, to: number) => { offset = from; limit = to - from + 1; calls.push({ table, method: "range", args: [from, to] }); return q; },
      upsert: (row: Row, options: unknown) => {
        calls.push({ table, method: "upsert", args: [row, options] });
        tables[table] ??= [];
        if (!tables[table].some(r => r.id === row.id)) tables[table].push(row);
        return q;
      },
      limit: (n: number) => { limit = n; calls.push({ table, method: "limit", args: [n] }); return q; },
      maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
      then: (resolve: (v: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    // PostgREST aliases change returned names without changing stored columns.
    for (const row of tables[table] ?? []) {
      if (table === "fee_reconcile_queue") row.created_at = row.enqueued_at;
      if (table === "restaurants") row.restaurant_id = row.id;
    }
    return q;
  });
  const rpc = vi.fn<(name: string, args?: unknown) => Promise<{ data: unknown; error: { message: string } | null }>>(
    async () => ({ data: { outcome: "completed" }, error: null }));
  const client = { refunds: { retrieve: vi.fn(), create: vi.fn() }, subscriptions: { retrieve: vi.fn() } };
  return { tables, errors, calls, from, rpc, client,
    context: { db: { from, rpc } as unknown as ReturnType<typeof createAdminClient>,
      client: client as unknown as Stripe, deadline: Date.now() + 10_000 } };
}
