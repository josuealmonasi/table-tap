import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "@/lib/api-guard";
import type { Outstanding } from "@/lib/table-outstanding";

interface Share { session_id: string; amount: number; tip: number }
interface Receipt extends Share { ref: string }
const ledger: Receipt[] = [];
const rpcs: { name: string; args: Record<string, unknown> }[] = [];
let failOn: string | null = null;
const endSplits = vi.fn();

// The old RPC commits each call. The batch commits only after every share
// succeeds, so the same injected second-sitting failure exposes the old loss.
function collect(share: Share, ref: string, pending: Receipt[]) {
  if (share.session_id === failOn) throw new Error("second sitting unavailable");
  if (ledger.some(p => p.ref === ref || (p.session_id === share.session_id &&
    (p.ref === "tap" || p.ref === `tap#${share.session_id}`)))) {
    return { outcome: "duplicate", taken: 0 };
  }
  const paid = ledger.filter(p => p.session_id === share.session_id).reduce((s, p) => s + p.amount - p.tip, 0);
  const taken = Math.min(share.amount, 100 - paid + share.tip);
  if (taken <= 0) return { outcome: "covered", taken: 0 };
  pending.push({ ...share, amount: taken, ref });
  return { outcome: "written", taken };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      try {
        if (name === "collect_on_sitting_v2") {
          const data = collect({ session_id: String(args.p_session), amount: Number(args.p_amount), tip: Number(args.p_tip) }, String(args.p_ref), ledger);
          return { data, error: null };
        }
        const shares = args.p_shares as Share[];
        const pending: Receipt[] = [];
        const seen = ledger.filter(p => p.ref === args.p_ref || p.ref.startsWith(`${args.p_ref}#`))
          .reduce((sum, p) => sum + p.amount, 0);
        let left = Math.max(0, Number(args.p_total) - seen);
        const data = shares.map(share => {
          const ref = shares.length === 1 && seen === 0
            ? String(args.p_ref) : `${args.p_ref}#${share.session_id}`;
          if (left <= 0) return { outcome: "duplicate", taken: 0 };
          const tip = seen > 0 ? 0 : share.tip;
          const outcome = collect({ ...share, tip, amount: Math.min(left, share.amount - share.tip + tip) }, ref, pending);
          left -= outcome.taken;
          return outcome;
        });
        ledger.push(...pending);
        return { data, error: null };
      } catch (error) {
        return { data: null, error: { message: (error as Error).message } };
      }
    },
  }),
}));
vi.mock("@/lib/table-session", () => ({ closeSessionsFor: vi.fn(), openSession: vi.fn() }));
vi.mock("@/lib/split-service", () => ({ endSplitsFor: (...args: unknown[]) => endSplits(...args) }));

import { record } from "@/lib/part-payment";

const actor = { restaurantId: "r1", email: "waiter@example.com" } as Actor;
const before = (sittings = [{ id: "old", owed: 100 }, { id: "new", owed: 100 }]): Outstanding => ({
  orders: [], sittings, ordered: 200, owed: 200, collected: 0, tips: 0,
});
const take = (state = before(), amount = 200, tip = 0, requested = amount) =>
  record(actor, state, "old", { amount, tip }, "cash", "tap", requested);

beforeEach(() => {
  ledger.length = 0;
  rpcs.length = 0;
  failOn = null;
  endSplits.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("one handful of cash across sittings", () => {
  it("records nothing when the second sitting fails and never reports success", async () => {
    failOn = "new";
    expect(await take()).toEqual({ wrote: false, refused: false, covered: false, landed: 0 });
    expect(ledger).toEqual([]);
    expect(endSplits).not.toHaveBeenCalled();
  });

  it("can retry the same complete collection after a second-sitting failure", async () => {
    failOn = "new";
    expect(await take(before(), 210, 10)).toMatchObject({ wrote: false, landed: 0 });
    expect(ledger).toEqual([]);
    failOn = null;
    expect(await take(before(), 210, 10)).toMatchObject({ wrote: true, landed: 210 });
    expect(ledger.reduce((sum, p) => sum + p.tip, 0)).toBe(10);
  });

  it("hands every share and the first sitting's tip to one transaction", async () => {
    expect(await take(before(), 210, 10)).toEqual({ wrote: true, refused: false, covered: false, landed: 210 });
    expect(rpcs).toEqual([{ name: "collect_on_sittings_v1", args: {
      p_restaurant: "r1", p_method: "cash", p_actor: actor.email, p_ref: "tap", p_total: 210,
      p_shares: [{ session_id: "old", amount: 110, tip: 10 }, { session_id: "new", amount: 100, tip: 0 }],
    } }]);
    expect(ledger.map(p => [p.ref, p.amount, p.tip])).toEqual([["tap#old", 110, 10], ["tap#new", 100, 0]]);
  });

  it("recovers a remaining sitting after partial success without reusing the first receipt", async () => {
    // A deployed older collector may have committed only the first share.
    ledger.push({ session_id: "old", amount: 100, tip: 0, ref: "tap" });
    expect(await take(before([{ id: "new", owed: 100 }]), 100, 0, 200)).toMatchObject({ wrote: true, landed: 100 });
    expect(ledger.map(p => p.ref)).toEqual(["tap", "tap#new"]);
    expect(await take(before([{ id: "new", owed: 100 }]), 100, 0, 200)).toMatchObject({ wrote: false, refused: true, landed: 0 });
    expect(ledger.reduce((s, p) => s + p.amount, 0)).toBe(200);
  });

  it("retries only the unpaid part of the original handful and never adds its tip twice", async () => {
    ledger.push({ session_id: "old", amount: 110, tip: 10, ref: "tap#old" });
    expect(await take(before([{ id: "new", owed: 100 }]), 110, 10, 160))
      .toMatchObject({ wrote: true, landed: 50 });
    expect(ledger.reduce((sum, p) => sum + p.amount, 0)).toBe(160);
    expect(ledger.reduce((sum, p) => sum + p.tip, 0)).toBe(10);
  });

  it("keeps a single sitting's reference and refuses a double tap", async () => {
    const one = before([{ id: "old", owed: 100 }]);
    await take(one, 40);
    expect(ledger[0].ref).toBe("tap");
    expect(await take(one, 40)).toMatchObject({ wrote: false, refused: true, landed: 0 });
    expect(ledger).toHaveLength(1);
  });

  it("caps a stale collection at live coverage and reports covered when nothing remains", async () => {
    ledger.push({ session_id: "old", amount: 100, tip: 0, ref: "colleague" },
      { session_id: "new", amount: 50, tip: 0, ref: "colleague#new" });
    expect(await take()).toEqual({ wrote: true, refused: false, covered: true, landed: 50 });
    expect(ledger.reduce((s, p) => s + p.amount, 0)).toBe(200);
  });
});
