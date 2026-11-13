import { beforeEach, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const state = vi.hoisted(() => ({
  claimed: [] as Row[], updates: [] as unknown[], sent: [] as unknown[], steps: [] as string[], claims: 0,
  mail: "sent" as "sent" | "failed", crashAfterSend: false, batches: [] as Row[][],
  card: { email: "ana@example.invalid", email_unsubscribe: "11111111-1111-4111-8111-111111111111" } as unknown,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    // The outbox: `claimed` holds the rows a claim returns; updates write to them,
    // so a key persisted by one drain is what the next claim reads.
    rpc: async () => {
      state.claims++;
      const batch = state.batches.length ? state.batches.shift()! : state.claimed;
      return { data: batch.map(r => ({ ...r })), error: null };
    },
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: table === "loyalty_cards" ? state.card : null, error: null });
      q.single = async () => ({ data: { name: "Demo Bistro", timezone: "America/Mexico_City" }, error: null });
      q.update = (patch: Record<string, unknown>) => {
        const w: Record<string, unknown> = {};
        const filters: Record<string, unknown> = {};
        w.eq = (col: string, value: unknown) => { filters[col] = value; return w; };
        w.is = () => w;
        // Awaited directly or through .select("id"); runs once either way. A
        // row whose claim moved on to another sender is not touched.
        w.in = (_c: string, ids: string[]) => {
          let done: Promise<string[]> | undefined;
          const run = () => done ??= (async () => {
            if (state.crashAfterSend && "finished_at" in patch) throw new Error("process died");
            const owned = ids.filter(id => {
              const r = state.claimed.find(x => x.id === id);
              return !r || !("claim" in filters) || r.claim === filters.claim;
            });
            state.steps.push("batch_key" in patch ? "persist" : "finish");
            state.updates.push({ patch, ids: owned });
            for (const r of state.claimed) if (owned.includes(r.id)) Object.assign(r, patch);
            return owned;
          })();
          return {
            then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => run().then(() => ({ error: null })).then(ok, fail),
            select: async () => ({ data: (await run()).map(id => ({ id })), error: null }),
          };
        };
        return w;
      };
      return q;
    },
  }),
}));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true, sendMail: async (m: unknown) => {
  state.steps.push("send");
  state.sent.push(m);
  return state.mail === "sent" ? { sent: true } : { sent: false, reason: "failed" };
} }));
vi.mock("@/lib/receipt-source", () => ({ readOrderReceipt: async () => ({ orders: [], restaurantId: "r", tableId: null }) }));
vi.mock("@/lib/receipt", () => ({
  buildReceipt: () => ({ subject: "Tu recibo", text: "Total", html: "<p>Total</p>" }),
  receiptModel: () => ({ code: "ORD-1" }),
}));
vi.mock("@/lib/ticket-pdf", () => ({ ticketPdf: async () => Buffer.from("%PDF-") }));
vi.mock("@/lib/ticket-place", () => ({ ticketPlace: async () => ({ name: "Demo Bistro" }), ticketText: () => ({}) }));
vi.mock("@/lib/ticket-loyalty", () => ({ ticketLoyalty: () => null }));

const { drainTicketEmails, drainTicketEmailQueue, batchKeyFor } = await import("@/lib/ticket-email");
const { maskEmail, normalizeEmail, emailForRole } = await import("@/lib/loyalty/card-email");
const KEY = "11111111-1111-4111-8111-111111111111";
const row = (id: string, order: string, session: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, restaurant_id: "r", card_id: "c", order_id: order, session_id: session, attempts: 1, address_key: KEY, batch_key: null, claim: "claim-1", ...extra });
const drain = async () => { vi.advanceTimersByTime(5000); await drainTicketEmails(); };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  Object.assign(state, { claimed: [], updates: [], sent: [], steps: [], claims: 0, mail: "sent", crashAfterSend: false, batches: [] });
});
const keys = () => (state.sent as { idempotencyKey: string }[]).map(m => m.idempotencyKey);
const finished = () => (state.updates as { patch: Record<string, unknown>; ids: string[] }[]).filter(u => "finished_at" in u.patch);

it("normalizes and masks the card's address", () => {
  expect(normalizeEmail("  Ana@Example.Invalid ")).toBe("ana@example.invalid");
  expect(normalizeEmail("nope")).toBeNull();
  expect(maskEmail("ana@example.invalid")).toBe("a***@example.invalid");
  expect(emailForRole("ana@example.invalid", false)).toBe("a***@example.invalid");
  expect(emailForRole("ana@example.invalid", true)).toBe("ana@example.invalid");
});

it("sends a table's orders paid together as one email, with the PDF and the stop link", async () => {
  state.claimed = [row("1", "o1", "s"), row("2", "o2", "s")];
  await drain();
  expect(state.sent).toHaveLength(1);
  const mail = state.sent[0] as { to: string; attachments: { filename: string }[]; headers: Record<string, string>; html: string; text: string };
  expect(mail.to).toBe("ana@example.invalid");
  expect(mail.text.split("\n").slice(-2)).toEqual(["Dejar de recibir mis tickets por correo:",
    `http://localhost:3000/tickets/stop?t=${KEY}`]);
  expect(mail.attachments[0].filename).toBe("ticket-ORD-1.pdf");
  expect(mail.headers["List-Unsubscribe"]).toContain("/tickets/stop?t=11111111-1111-4111-8111-111111111111");
  expect(finished()).toEqual([{ patch: expect.objectContaining({ outcome: "sent" }), ids: ["1", "2"] }]);
});

it("finishes as no_email when the address was removed before sending", async () => {
  state.card = { email: null, email_unsubscribe: null };
  state.claimed = [row("1", "o1", null)];
  await drain();
  expect(state.sent).toHaveLength(0);
  expect(finished()).toEqual([{ patch: expect.objectContaining({ outcome: "no_email" }), ids: ["1"] }]);
  state.card = { email: "ana@example.invalid", email_unsubscribe: "11111111-1111-4111-8111-111111111111" };
});

it("never sends a ticket queued for one address to the card's new address (Codex review of #622)", async () => {
  state.claimed = [row("1", "o1", null, { address_key: "22222222-2222-4222-8222-222222222222" })];
  await drain();
  expect(state.sent).toHaveLength(0);
  expect(finished()).toEqual([{ patch: expect.objectContaining({ outcome: "no_email" }), ids: ["1"] }]);
});

it("retries a failed group with the same idempotency key (Codex review of #622)", async () => {
  state.claimed = [row("1", "o1", "s", { batch_key: "ticket-fixed" })];
  await drain();
  expect((state.sent[0] as { idempotencyKey: string }).idempotencyKey).toBe("ticket-fixed");
});

it("writes the group's key before calling the provider, derived from its rows (Codex review of #622)", async () => {
  state.claimed = [row("2", "o2", "s"), row("1", "o1", "s")];
  await drain();
  expect(state.steps).toEqual(["persist", "send", "finish"]);
  expect(keys()).toEqual([batchKeyFor(["1", "2"])]);
  expect(batchKeyFor(["2", "1"])).toBe(batchKeyFor(["1", "2"]));
  expect(state.updates[0]).toEqual({ patch: { batch_key: batchKeyFor(["1", "2"]) }, ids: ["2", "1"] });
});

it("a sender that dies after the provider accepted re-sends with the same key", async () => {
  state.claimed = [row("1", "o1", "s"), row("2", "o2", "s")];
  state.crashAfterSend = true;
  await drain();
  expect(state.sent).toHaveLength(1);
  expect(finished()).toEqual([]);
  // The claim lapses and the rows come back, still carrying the persisted key.
  state.crashAfterSend = false;
  await drain();
  expect(keys()).toEqual([batchKeyFor(["1", "2"]), batchKeyFor(["1", "2"])]);
  expect(state.steps.filter(x => x === "persist")).toHaveLength(1);
});

it("a failed send retries with its key, and a later ticket of the same sitting is not added to it", async () => {
  state.claimed = [row("1", "o1", "s")];
  state.mail = "failed";
  await drain();
  expect(state.updates.at(-1)).toEqual({ patch: { claimed_at: null, claim: null }, ids: ["1"] });
  state.mail = "sent";
  state.claimed.push(row("2", "o2", "s"));
  await drain();
  expect(keys()).toEqual([batchKeyFor(["1"]), batchKeyFor(["1"]), batchKeyFor(["2"])]);
});

it("separates address generations: only the obsolete row is discarded (Codex review of #622)", async () => {
  state.claimed = [row("1", "o1", "s", { address_key: "22222222-2222-4222-8222-222222222222" }), row("2", "o2", "s")];
  await drain();
  expect(state.sent).toHaveLength(1);
  expect(keys()).toEqual([batchKeyFor(["2"])]);
  expect(finished()).toEqual([
    { patch: expect.objectContaining({ outcome: "no_email" }), ids: ["1"] },
    { patch: expect.objectContaining({ outcome: "sent" }), ids: ["2"] },
  ]);
});

it("a drain inside the throttle window waits it out instead of dropping it, and waiters share one drain", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout"] });
  vi.advanceTimersByTime(10_000);
  await drainTicketEmails();
  expect(state.claims).toBe(1);
  state.claimed = [row("1", "o1", "s")];
  const first = drainTicketEmails();
  const second = drainTicketEmails();
  expect(state.claims).toBe(1);
  await vi.advanceTimersByTimeAsync(3000);
  await Promise.all([first, second]);
  expect(state.claims).toBe(2);
  expect(state.sent).toHaveLength(1);
  vi.useRealTimers();
});

it("the cron drains until the queue is empty, not one claim (Codex review of #622)", async () => {
  const many = (from: number, n: number) => Array.from({ length: n }, (_, i) => row(`${from + i}`, `o${from + i}`, null));
  state.batches = [many(0, 50), many(50, 50), many(100, 3)];
  await drainTicketEmailQueue();
  expect(state.claims).toBe(3);
  expect(state.sent).toHaveLength(103);
});

it("the cron stops when a claim brings back only rows it already tried", async () => {
  const same = Array.from({ length: 50 }, (_, i) => row(`${i}`, `o${i}`, null));
  state.batches = [same, same, same];
  state.mail = "failed";
  await drainTicketEmailQueue();
  expect(state.claims).toBe(2);
});

it("a sender whose lease another sender took sends nothing and finishes nothing", async () => {
  // This sender claimed a and b, then stalled past the lease; another sender
  // has since claimed b. Keying only a would split the group under one key.
  state.batches = [[row("a", "o1", "s1"), row("b", "o2", "s1")]];
  state.claimed = [row("a", "o1", "s1"), row("b", "o2", "s1", { claim: "claim-2" })];
  await drainTicketEmailQueue(1);
  expect(state.sent).toHaveLength(0);
  expect(finished()).toHaveLength(0);
});
