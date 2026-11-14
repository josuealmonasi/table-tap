import { beforeEach, expect, it, vi } from "vitest";

/**
 * Pedidos polls the open returns every 15 s. A restaurant with 38 open
 * operations sent 38 progress RPCs at once, and scheduled fee recovery (a
 * write path that may call Stripe) on every read. The list now reads each
 * table once, batches progress into one RPC, and schedules nothing.
 */
const OPEN = 40;
const { rpc, from, after, tables } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), after: vi.fn(), tables: [] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
const { orderRefunds } = await import("../operations");

const operations = Array.from({ length: OPEN }, (_, i) => ({
  id: `op-${String(i).padStart(2, "0")}`, adjustment_id: `adj-${i}`, source: "terminal", amount: i + 1, tip: 0,
  currency: "MXN", status: "review", original_collector: null, created_at: "2026-11-12T00:00:00Z",
}));
const progress = operations.map((o, i) => ({ operation_id: o.id, outstanding_cents: i * 100, unresolved: false }));
function progressQuery(data: typeof progress | null, error: { message: string } | null = null) {
  const q = { order: () => q, range: async (start: number, end: number) => ({ data: data?.slice(start, Math.min(end + 1, start + 25)) ?? null, error }) };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  tables.length = 0;
  from.mockImplementation((table: string) => {
    tables.push(table);
    const rows = table === "refund_operations" ? operations
      : table === "order_adjustments" ? operations.map((o, i) => ({ id: o.adjustment_id, order_id: `order-${i}`, kind: "return" }))
        : operations.map((_, i) => ({ id: `order-${i}`, table_label: `${i}` }));
    const q = { select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q,
      range: async (start: number) => ({ data: start === 0 ? rows : [], error: null }) };
    return q;
  });
  rpc.mockImplementation((name: string, args: { p_operation?: string }) => name === "refund_operation_progress_v1"
    ? Promise.resolve({ data: progress.find(p => p.operation_id === args.p_operation), error: null })
    : Object.assign(progressQuery(progress), { range: async () => ({ data: [...progress].reverse(), error: null }) }));
});

it("matches per-id progress in input order with one batched progress call", async () => {
  const list = await orderRefunds("tenant");
  expect(list.map(r => r.id)).toEqual(operations.map(o => o.id));
  const perId = await Promise.all(operations.map(o => rpc("refund_operation_progress_v1", { p_operation: o.id })));
  expect(list.map(r => r.outstanding_cents)).toEqual(perId.map(r => r.data.outstanding_cents));
  const batchCalls = rpc.mock.calls.filter(([name]) => name === "refund_operations_progress_v1");
  expect(perId.map(r => r.data)).toEqual(progress);
  expect(list[7]).toMatchObject({ order_id: "order-7", table_label: "7", kind: "return" });
  // Paged reads (a page, then the empty page that ends it), never one per operation.
  for (const table of ["refund_operations", "order_adjustments", "orders"]) {
    expect(tables.filter(t => t === table).length).toBeLessThanOrEqual(2);
  }
  expect(batchCalls).toEqual([["refund_operations_progress_v1", {
    p_restaurant: "tenant", p_ids: operations.map(o => o.id),
  }]]);
});

it("schedules no fee recovery from the polled list", async () => {
  await orderRefunds("tenant");
  expect(after).not.toHaveBeenCalled();
});

it("still refuses to show a return whose progress cannot be verified", async () => {
  rpc.mockReturnValue(progressQuery(null, { message: "down" }));
  await expect(orderRefunds("tenant")).rejects.toThrow("Could not verify the outstanding return");
});

it("continues a server-capped batch instead of losing open returns", async () => {
  rpc.mockReturnValue(progressQuery(progress));
  expect((await orderRefunds("tenant")).map(r => r.outstanding_cents)).toEqual(progress.map(p => p.outstanding_cents));
  expect(rpc).toHaveBeenCalledTimes(2);
});

it.each(["missing", "duplicate", "negative", "fractional", "foreign"])("rejects %s progress instead of reporting a guessed balance", async problem => {
  const data = progress.map(p => ({ ...p }));
  if (problem === "missing") data.pop();
  if (problem === "duplicate") data[1] = { ...data[0] };
  if (problem === "negative") data[0].outstanding_cents = -1;
  if (problem === "fractional") data[0].outstanding_cents = 1.5;
  if (problem === "foreign") data[0].operation_id = "other";
  rpc.mockReturnValue(progressQuery(data));
  await expect(orderRefunds("tenant")).rejects.toThrow("Could not verify the outstanding return");
});
