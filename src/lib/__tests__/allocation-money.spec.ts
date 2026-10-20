import { describe, expect, it, vi } from "vitest";
import { checkAllocations } from "../../../scripts/money-allocations.mjs";

describe("the allocation money check", () => {
  it.each([false, true])("rejects swapped principal and tip unless historical breakdown is explicitly unknown (%s)", async unknown => {
    const bad = vi.fn();
    const snapshots: Record<string, unknown[]> = { payment_allocations: [{ id: "a", restaurant_id: "r", order_id: "o",
      payment_id: "p", amount: 100, tip: 20 }], refund_allocations: [], refund_operations: [], order_adjustments: [] };
    const db = { from: (table: string) => ({ select: () => snapshots[table] }) };
    const all = async (build: () => unknown) => ({ data: build(), error: null });
    await checkAllocations(db, all, [{ id: "o", restaurant_id: "r", paid: true, written_off: false,
      status: "completed", total: 100, tip: 0 }], [{ id: "p", restaurant_id: "r", amount: 100, tip: 20,
      allocation_version: 1, allocation_quality: "estimated", unallocated_amount: 0, unallocated_tip: 0,
      allocation_origin: "legacy", breakdown_unknown: unknown }], { ok: vi.fn(), bad });
    if (unknown) expect(bad).not.toHaveBeenCalled();
    else expect(bad).toHaveBeenCalledWith(expect.stringContaining("principal or tip"));
  });
});
