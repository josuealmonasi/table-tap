import { beforeEach, expect, it, vi } from "vitest";

// "No enviar esta vez" on a whole table must cover exactly what the money
// writer settles: every outstanding order of the table in that currency,
// older sittings included (Codex review of #622).
type Filter = [string, string, unknown];
const s = vi.hoisted(() => ({ reads: [] as Filter[][], writes: [] as { patch: unknown; filters: Filter[] }[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const build = (patch?: unknown) => {
      const filters: Filter[] = [];
      const q: Record<string, unknown> = {};
      for (const m of ["eq", "is", "in", "neq"]) q[m] = (c: string, v: unknown) => { filters.push([m, c, v]); return q; };
      q.then = (done: (v: unknown) => void) => {
        if (patch) { s.writes.push({ patch, filters }); done({ error: null }); return; }
        s.reads.push(filters);
        done({ data: [{ id: "old-sitting" }, { id: "current-sitting" }], error: null });
      };
      return q;
    };
    return { select: () => build(), update: (patch: unknown) => build(patch) };
  },
}) }));
const { skipTicketEmails } = await import("@/lib/ticket-email");
const r = "restaurant-1";
beforeEach(() => { s.reads = []; s.writes = []; });

it("marks the table's outstanding orders the collection settles, in its currency, every sitting", async () => {
  await skipTicketEmails(r, { tableId: "table-1", currency: "MXN" });
  expect(s.reads[0]).toEqual(expect.arrayContaining([
    ["eq", "restaurant_id", r], ["eq", "table_id", "table-1"], ["eq", "currency", "MXN"], ["eq", "paid", false],
    ["eq", "written_off", false], ["is", "account_id", null], ["eq", "ticket_email_skip", false],
    ["neq", "status", "pending_payment"], ["neq", "status", "cancelled"],
  ]));
  // No sitting filter: the writer settles older sittings' orders too.
  expect(s.reads[0].some(([, column]) => column === "session_id")).toBe(false);
  expect(s.writes).toEqual([{ patch: { ticket_email_skip: true }, filters: [["eq", "restaurant_id", r], ["in", "id", ["old-sitting", "current-sitting"]]] }]);
});

it("skip false clears the mark, and its undo puts it back on the same orders only", async () => {
  const undo = await skipTicketEmails(r, { orderIds: ["a", "b"] }, false);
  expect(s.reads[0]).toEqual(expect.arrayContaining([["eq", "ticket_email_skip", true], ["in", "id", ["a", "b"]]]));
  await undo();
  expect(s.writes.map(w => w.patch)).toEqual([{ ticket_email_skip: false }, { ticket_email_skip: true }]);
  expect(s.writes[1].filters).toEqual(expect.arrayContaining([["eq", "restaurant_id", r], ["eq", "paid", false], ["is", "account_id", null]]));
});
