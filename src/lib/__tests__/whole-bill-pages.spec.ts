import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, retrieve, rows } = vi.hoisted(() => ({ rpc: vi.fn(), retrieve: vi.fn(), rows: { pages: [] as object[] } }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { retrieve } } } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = (data: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "overlaps"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
      return q;
    };
    return {
      rpc,
      from: (table: string) => table === "bill_splits" ? chain({ order_ids: ["o1"] })
        : table === "diner_checkouts" ? chain(rows.pages) : chain([{ id: "o1" }]),
    };
  },
}));
import { splitRpc } from "@/lib/split-slots-rpc";

beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, "error").mockImplementation(() => undefined); });
const page = { id: "c1", stripe_session_id: "cs_1", stripe_account_id: "acct_1", split_id: null, metadata: {} };

describe("a whole-bill card page blocking a divided bill (#576 R1)", () => {
  it("closes a page Stripe says expired and tries once more", async () => {
    rows.pages = [page];
    retrieve.mockResolvedValue({ status: "expired" });
    rpc.mockImplementation(async (name: string) => ({ data: name === "finish_diner_checkout" ? null
      : { outcome: rpc.mock.calls.filter(c => c[0] === "collect_split_slots_v1").length > 1 ? "collected" : "paying" }, error: null }));
    expect((await splitRpc("collect_split_slots_v1", { p_restaurant: "r1", p_split: "s1" })).outcome).toBe("collected");
    expect(rpc).toHaveBeenCalledWith("finish_diner_checkout", { p_attempt: "c1", p_paid: false });
  });
  it("keeps refusing while Stripe says the page is open or paid", async () => {
    for (const status of ["open", "complete"]) {
      rpc.mockReset(); rows.pages = [page];
      retrieve.mockResolvedValue({ status });
      rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
      expect((await splitRpc("collect_split_slots_v1", { p_restaurant: "r1", p_split: "s1" })).outcome).toBe("paying");
      expect(rpc).not.toHaveBeenCalledWith("finish_diner_checkout", expect.anything());
    }
  });
  it("keeps refusing when Stripe cannot be read", async () => {
    rows.pages = [page]; retrieve.mockRejectedValue(new Error("network"));
    rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
    expect((await splitRpc("start_bill_split_v2", { p_restaurant: "r1", p_session: "t1" })).outcome).toBe("paying");
  });
  it("never touches a part's own page", async () => {
    rows.pages = [{ ...page, metadata: { split_model: "2" } }];
    rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
    await splitRpc("reserve_split_slots_v1", { p_restaurant: "r1", p_split: "s1" });
    expect(retrieve).not.toHaveBeenCalled();
  });
});
