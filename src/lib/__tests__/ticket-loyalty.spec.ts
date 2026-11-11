import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ orders: [] as unknown[], sessions: [] as unknown[], card: null as unknown }));
vi.mock("@/lib/loyalty/server", () => ({
  CARD_COLUMNS: "id, goal, steps, round_no",
  programOf: async () => ({ reward: "Postre gratis" }),
  cardState: async () => ({ progress: 5, ladder: [{ visits: 8, reward: "Postre gratis" }], done: [] }),
}));
const { ticketLoyalty } = await import("@/lib/ticket-loyalty");

/** A query that answers by table, whatever filters are chained on it. */
function db() {
  const rows: Record<string, () => unknown> = {
    orders: () => ({ data: state.orders, error: null }),
    table_sessions: () => ({ data: state.sessions, error: null }),
    loyalty_cards: () => ({ data: state.card, error: null }),
  };
  return { from: (table: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "not", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => rows[table]();
    q.then = (resolve: (v: unknown) => unknown) => resolve(rows[table]());
    return q;
  } } as never;
}
const t = (key: string, vars?: Record<string, string | number>) => `${key} ${JSON.stringify(vars ?? {})}`;

beforeEach(() => {
  state.orders = []; state.sessions = [];
  state.card = { id: "c1", goal: 8, steps: null, round_no: 1, code: "ABCDEFGHK7P2" };
});

it("prints the card the sale carries: last four only, where it stands, the next reward in the app's words", async () => {
  state.orders = [{ loyalty_card_id: "c1", session_id: null }];
  const l = await ticketLoyalty(db(), "r", ["o1"], t);
  expect(l).toEqual({ last4: "K7P2", progress: 5, goal: 8, message: 'rewards.toGo {"n":3,"reward":"Postre gratis"}' });
});

it("falls back to the card on the table's bill when the sale has none", async () => {
  state.orders = [{ loyalty_card_id: null, session_id: "s1" }];
  state.sessions = [{ loyalty_card_id: "c1" }];
  expect((await ticketLoyalty(db(), "r", ["o1"], t))?.last4).toBe("K7P2");
});

it("prints nothing when no card was presented, or the card cannot be read", async () => {
  state.orders = [{ loyalty_card_id: null, session_id: null }];
  expect(await ticketLoyalty(db(), "r", ["o1"], t)).toBeNull();
  state.orders = [{ loyalty_card_id: "c1", session_id: null }];
  state.card = null;
  expect(await ticketLoyalty(db(), "r", ["o1"], t)).toBeNull();
  expect(await ticketLoyalty(db(), "r", [], t)).toBeNull();
});
