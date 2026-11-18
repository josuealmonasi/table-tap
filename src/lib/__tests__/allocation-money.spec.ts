import { describe, expect, it, vi } from "vitest";
import { checkAllocations } from "../../../scripts/money-allocations.mjs";

describe("the allocation money check", () => {
  it("keeps a historical card return and its reason in the review list", async () => {
    const snapshots: Record<string, unknown[]> = { refund_operations: [{ id: "card-return", source: "review",
      status: "review", amount: 10, tip: 0, historical_import_reason: "Historical card return needs provider evidence" }] };
    const select = vi.fn();
    const db = { from: (table: string) => {
      const q = { select: (fields: string) => { select(table, fields); return q; }, eq: () => q,
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(snapshots[table] ?? []).then(resolve) };
      return q;
    } };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await checkAllocations(db, async (build: () => unknown) => ({ data: build(), error: null }),
        [], [], { ok: vi.fn(), bad: vi.fn() });
      expect(select).toHaveBeenCalledWith("refund_operations", expect.stringContaining("historical_import_reason"));
      expect(log).toHaveBeenCalledWith(expect.stringContaining("card-return: review, 10, Historical card return needs provider evidence"));
      expect(result.exceptions).toBe(1);
    } finally { log.mockRestore(); }
  });
  it.each([false, true])("rejects swapped principal and tip unless historical breakdown is explicitly unknown (%s)", async unknown => {
    const bad = vi.fn();
    const snapshots: Record<string, unknown[]> = { payment_allocations: [{ id: "a", restaurant_id: "r", order_id: "o",
      payment_id: "p", amount: 100, tip: 20 }], refund_allocations: [], refund_operations: [], order_adjustments: [] };
    const db = { from: (table: string) => {
      const q = { select: () => q, eq: () => q, then: (resolve: (value: unknown) => unknown) => Promise.resolve(snapshots[table] ?? []).then(resolve) };
      return q;
    } };
    const all = async (build: () => unknown) => ({ data: build(), error: null });
    await checkAllocations(db, all, [{ id: "o", restaurant_id: "r", paid: true, written_off: false,
      status: "completed", total: 100, tip: 0 }], [{ id: "p", restaurant_id: "r", amount: 100, tip: 20,
      allocation_version: 1, allocation_quality: "estimated", unallocated_amount: 0, unallocated_tip: 0,
      allocation_origin: "legacy", breakdown_unknown: unknown }], { ok: vi.fn(), bad });
    if (unknown) expect(bad).not.toHaveBeenCalled();
    else expect(bad).toHaveBeenCalledWith(expect.stringContaining("principal or tip"));
  });
});
