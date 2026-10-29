import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, retrieve, rows } = vi.hoisted(() => ({ rpc: vi.fn(), retrieve: vi.fn(), rows: { pages: [] as object[], after: "open" } }));
vi.mock("@/lib/stripe", () => ({ stripe: { checkout: { sessions: { retrieve } } } }));
const { resume } = vi.hoisted(() => ({ resume: vi.fn() }));
vi.mock("@/lib/diner-attempt", () => ({ resumeDinerAttempt: resume }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    let table = "";
    const chain = (data: unknown) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "overlaps"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === "diner_checkouts" ? { status: rows.after } : data, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data, error: null });
      return q;
    };
    return {
      rpc,
      from: (name: string) => (table = name) === "bill_splits" ? chain({ order_ids: ["o1"] })
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
  it("resolves an unbound page through its saved request, but not one older than a day", async () => {
    rpc.mockImplementation(async () => ({ data: { outcome: rpc.mock.calls.length > 1 ? "collected" : "paying" }, error: null }));
    rows.pages = [{ ...page, stripe_session_id: null, scope_key: "k1", created_at: new Date().toISOString() }];
    rows.after = "expired";
    expect((await splitRpc("collect_split_slots_v1", { p_restaurant: "r1", p_split: "s1" })).outcome).toBe("collected");
    expect(resume).toHaveBeenCalledWith(expect.anything(), "r1", "k1");
    resume.mockClear(); rpc.mockReset(); rpc.mockResolvedValue({ data: { outcome: "paying" }, error: null });
    rows.pages = [{ ...page, stripe_session_id: null, scope_key: "k1", created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString() }];
    expect((await splitRpc("collect_split_slots_v1", { p_restaurant: "r1", p_split: "s1" })).outcome).toBe("paying");
    expect(resume).not.toHaveBeenCalled();
  });
});
