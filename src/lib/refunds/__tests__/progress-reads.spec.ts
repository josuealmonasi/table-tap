import { beforeEach, expect, it, vi } from "vitest";

/**
 * Pedidos polls the open returns every 15 s. A restaurant with 38 open
 * operations sent 38 progress RPCs at once, and scheduled fee recovery (a
 * write path that may call Stripe) on every read. The list now reads each
 * table once, keeps a bounded number of progress reads in flight, and
 * schedules nothing.
 */
const OPEN = 40;
const { rpc, from, after, tables } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), after: vi.fn(), tables: [] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from }) }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
const { orderRefunds, PROGRESS_READS_AT_ONCE } = await import("../operations");

const operations = Array.from({ length: OPEN }, (_, i) => ({
  id: `op-${String(i).padStart(2, "0")}`, adjustment_id: `adj-${i}`, source: "terminal", amount: i + 1, tip: 0,
  currency: "MXN", status: "review", original_collector: null, created_at: "2026-11-12T00:00:00Z",
}));
let inFlight = 0;
let most = 0;

beforeEach(() => {
  vi.clearAllMocks();
  tables.length = 0; inFlight = 0; most = 0;
  from.mockImplementation((table: string) => {
    tables.push(table);
    const rows = table === "refund_operations" ? operations
      : table === "order_adjustments" ? operations.map((o, i) => ({ id: o.adjustment_id, order_id: `order-${i}`, kind: "return" }))
        : operations.map((_, i) => ({ id: `order-${i}`, table_label: `${i}` }));
    const q = { select: () => q, eq: () => q, neq: () => q, in: () => q, order: () => q,
      range: async (start: number) => ({ data: start === 0 ? rows : [], error: null }) };
    return q;
  });
  rpc.mockImplementation(async (_name: string, { p_operation }: { p_operation: string }) => {
    inFlight++; most = Math.max(most, inFlight);
    await new Promise(resolve => setTimeout(resolve, 1));
    inFlight--;
    return { data: { outstanding_cents: Number(p_operation.slice(3)) * 100, unresolved: false }, error: null };
  });
});

it("pages each table instead of one read per operation, and keeps a bounded number of progress reads in flight", async () => {
  const list = await orderRefunds("tenant");
  expect(list.map(r => r.id)).toEqual(operations.map(o => o.id));
  expect(list.map(r => r.outstanding_cents)).toEqual(operations.map((_, i) => i * 100));
  expect(list[7]).toMatchObject({ order_id: "order-7", table_label: "7", kind: "return" });
  // Paged reads (a page, then the empty page that ends it), never one per operation.
  for (const table of ["refund_operations", "order_adjustments", "orders"]) {
    expect(tables.filter(t => t === table).length).toBeLessThanOrEqual(2);
  }
  expect(rpc).toHaveBeenCalledTimes(OPEN);
  expect(most).toBe(PROGRESS_READS_AT_ONCE);
});

it("schedules no fee recovery from the polled list", async () => {
  await orderRefunds("tenant");
  expect(after).not.toHaveBeenCalled();
});

it("still refuses to show a return whose progress cannot be verified", async () => {
  rpc.mockImplementation(async (_name: string, { p_operation }: { p_operation: string }) =>
    p_operation === "op-33" ? { data: null, error: { message: "down" } } : { data: { outstanding_cents: 0 }, error: null });
  await expect(orderRefunds("tenant")).rejects.toThrow("Could not verify the outstanding return");
});
