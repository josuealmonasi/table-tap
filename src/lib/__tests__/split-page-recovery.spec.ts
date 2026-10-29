import { beforeEach, expect, it, vi } from "vitest";
const { rpc, resolve, whole } = vi.hoisted(() => ({ rpc: vi.fn(), resolve: vi.fn(), whole: vi.fn() }));
const s = vi.hoisted(() => ({ slots: [0], missing: false, error: false }));
vi.mock("@/lib/whole-bill-pages", () => ({ resolveCheckoutPages: resolve, closeExpiredWholeBillPages: whole }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc, from: () => {
  const q = { select: () => q, eq: () => q,
    in: (_key: string, slots: number[]) => { s.slots = slots; return q; },
    then: (done: (v: unknown) => unknown) => Promise.resolve({ data: s.missing ? [] : s.slots.map(share_no => ({
      share_no, reserved_checkout_id: `attempt-${share_no}`, payment_id: null,
    })), error: s.error ? { message: "unavailable" } : null }).then(done),
  }; return q;
} }) }));
const { splitRpc } = await import("@/lib/split-slots-rpc");
beforeEach(() => { vi.clearAllMocks(); rpc.mockReset(); whole.mockResolvedValue(false); resolve.mockResolvedValue("closed"); s.missing = false; s.error = false; });
it.each(["reserved", "taken"])("a %s selected part resolves only its owner, then retries once", async outcome => {
  rpc.mockResolvedValueOnce({ data: { outcome }, error: null }).mockResolvedValueOnce({ data: { outcome: "collected" }, error: null });
  const args = { p_restaurant: "r1", p_split: "split", p_slots: [0], p_expected_cents: 5000, p_tip_cents: 200, p_ref: "original" };
  expect((await splitRpc("collect_split_slots_v1", args)).outcome).toBe("collected");
  expect(resolve).toHaveBeenCalledWith("r1", { checkoutIds: ["attempt-0"], splitId: "split" });
  expect(rpc).toHaveBeenCalledTimes(2); expect(rpc.mock.calls[1]).toEqual(rpc.mock.calls[0]);
});
it.each(["unresolved", "unverified"])("a %s part keeps the selection refused", async outcome => {
  resolve.mockResolvedValue(outcome); rpc.mockResolvedValue({ data: { outcome: "reserved" }, error: null });
  expect((await splitRpc("collect_split_slots_v1", { p_restaurant: "r1", p_split: "split", p_slots: [0] })).outcome).toBe("reserved");
  expect(rpc).toHaveBeenCalledTimes(1);
});
it.each(["missing", "error"] as const)("a %s selection never authorizes a retry", async failure => {
  s[failure] = true; rpc.mockResolvedValue({ data: { outcome: "reserved" }, error: null });
  await splitRpc("collect_split_slots_v1", { p_restaurant: "r1", p_split: "split", p_slots: [0] });
  expect(resolve).not.toHaveBeenCalled(); expect(rpc).toHaveBeenCalledTimes(1);
});
