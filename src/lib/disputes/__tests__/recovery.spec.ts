import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { fixture, notification } from "./fixtures";
vi.mock("@/lib/stripe", () => ({ stripe: {} }));
import { ingestDispute } from "../ingest";
import { recoverDisputes } from "@/lib/recovery/disputes";

/** The recovery query, scripted: only the states it asks for come back. */
function eventsQuery(f: ReturnType<typeof fixture>) {
  let states: string[] = [];
  const q = { select: () => q, in: (_: string, v: string[]) => { states = v; return q; }, order: () => q, range: () => q,
    returns: async () => { const rows = [...f.events.values()].filter(e => states.includes(String(e.state))); return { data: rows, count: rows.length, error: null }; } };
  const original = f.from.getMockImplementation()!;
  f.from.mockImplementation(table => table === "stripe_dispute_events" ? q as never : original(table));
}

it("the existing bounded runner retries provider failures without another webhook", async () => {
  const f = fixture();
  f.client.disputes.retrieve.mockRejectedValueOnce(new Error("offline"));
  await ingestDispute(notification(), f.db, f.stripe);
  eventsQuery(f);
  expect(await recoverDisputes({ db: f.db, client: f.stripe, deadline: Date.now() + 10000 })).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(f.events.get("evt")?.state).toBe("done");
});

it("an event set aside for review after repeated failures is not polled again", async () => {
  const f = fixture();
  f.client.disputes.retrieve.mockRejectedValueOnce(new Error("Conflicting dispute ownership"));
  await ingestDispute(notification(), f.db, f.stripe);
  f.events.get("evt")!.state = "review";
  f.rpc.mockClear();
  eventsQuery(f);
  expect(await recoverDisputes({ db: f.db, client: f.stripe, deadline: Date.now() + 10000 })).toMatchObject({ done: 0, pending: 0, failed: 0 });
  expect(f.rpc).not.toHaveBeenCalledWith("claim_stripe_dispute_event", expect.anything());
});

it("SQL caps failed attempts into review, which neither recovery nor deletion waits on", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const fail = sql.slice(sql.lastIndexOf("create or replace function public.fail_stripe_dispute_event(")).split("end $$;")[0];
  expect(fail).toContain("state = case when attempts >= 10 then 'review' else 'error' end");
  expect(sql).toContain("check (state in ('pending', 'processing', 'error', 'review', 'done'))");
  const deletion = sql.slice(sql.lastIndexOf("create or replace function public.admin_delete_restaurant(")).split("$$;")[0];
  expect(deletion).toContain("from stripe_dispute_events e where e.state not in ('done', 'review')");
  // Still archived with the restaurant for the platform to look at.
  const archive = deletion.slice(deletion.indexOf("foreach v_table in array array[")).split("] loop")[0];
  expect(archive).toContain("'stripe_dispute_events'");
});
