import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { mailFailure } from "@/lib/mail";
import { outboxPatch, ticketOutcome } from "@/lib/ticket-email-retry";

// Background-job review (2026-11-12), the parts that live in SQL.
const sql = readFileSync("supabase/schema.sql", "utf8");
const fn = (name: string) => sql.slice(sql.lastIndexOf(`create or replace function public.${name}(`)).split("$$;")[0];

it("finding 6: re-queuing a charge keeps its first queued time, so the overdue warning still ages", () => {
  const body = fn("enqueue_fee_reconcile");
  expect(body).toContain("do update set generation = excluded.generation;");
  expect(body).not.toMatch(/enqueued_at\s*=\s*now\(\)/);
});

it("finding 11: a sale settled by forgiving a walkout earns no stamp and queues no ticket email", () => {
  for (const trigger of ["stamp_loyalty_on_payment", "queue_ticket_email"]) {
    expect(fn(trigger)).toContain("public.settled_by_write_off(new.restaurant_id, new.id)");
  }
  const check = fn("settled_by_write_off");
  expect(check).toContain("current_setting('tabletap.walkout_writer', true)");
  expect(check).toContain("a.kind = 'forgive'");
  // Defined before the triggers that call it, and as plpgsql: order_adjustments comes later in the file.
  expect(sql.indexOf("function public.settled_by_write_off(")).toBeLessThan(sql.indexOf("function public.stamp_loyalty_on_payment("));
  expect(check).toContain("language plpgsql");
  expect(sql).toContain("create index if not exists order_adjustments_forgiven_order on order_adjustments (order_id) where kind = 'forgive';");
  // The walkout writer marks only the loop that settles orders, and clears it after.
  const writer = fn("write_off_remainder_v1");
  const mark = writer.indexOf("set_config('tabletap.walkout_writer', p_ref::text, true)");
  const settle = writer.indexOf("update orders set total = round(o.covered, 2)");
  const clear = writer.indexOf("set_config('tabletap.walkout_writer', '', true)");
  expect(mark).toBeGreaterThan(0);
  expect(mark).toBeLessThan(settle);
  expect(clear).toBeGreaterThan(settle);
  expect(writer.indexOf("update orders set paid = true, status = 'completed'")).toBeGreaterThan(mark);
  expect(readFileSync("supabase/drop.sql", "utf8")).toContain("drop function if exists public.settled_by_write_off(uuid, uuid);");
});

it("finding 2: the claim skips rows waiting out their backoff and serves fresh tickets first", () => {
  const claim = fn("claim_ticket_emails");
  expect(claim).toContain("and (t.next_attempt_at is null or t.next_attempt_at <= now())");
  expect(claim).toContain("order by t.attempts, t.created_at");
  expect(claim).toContain("outcome = 'expired', mail_body = null");
  for (const column of ["next_attempt_at timestamptz", "failure_reason text", "mail_body jsonb"]) {
    expect(sql).toContain(`alter table ticket_email_outbox add column if not exists ${column};`);
  }
});

it("finding 3: the subscription's period end has a column", () => {
  expect(sql).toContain("alter table restaurants add column if not exists plan_period_ends_at timestamptz;");
});

it("finding 2: a 429, a 5xx or a request in flight is retryable; a validation refusal is not", () => {
  expect(mailFailure(429, '{"name":"rate_limit_exceeded"}')).toEqual({ retryable: true, status: 429, code: "rate_limit_exceeded" });
  expect(mailFailure(503, "")).toEqual({ retryable: true, status: 503 });
  expect(mailFailure(409, '{"name":"concurrent_idempotent_requests"}')).toMatchObject({ retryable: true });
  expect(mailFailure(422, '{"name":"validation_error"}')).toMatchObject({ retryable: false, code: "validation_error" });
  expect(mailFailure(403, "not json")).toEqual({ retryable: false, status: 403 });
});

it("finding 2: backoff is 1 minute, 10 minutes, an hour, then the ticket is given up with a reason", () => {
  const now = Date.parse("2026-11-12T00:00:00.000Z");
  const failed = ticketOutcome({ sent: false, reason: "failed", retryable: true, status: 500 });
  expect([1, 2, 3].map(n => Date.parse(String(outboxPatch(failed, n, now).next_attempt_at)) - now)).toEqual([60_000, 600_000, 3_600_000]);
  expect(outboxPatch(failed, 4, now)).toEqual({ finished_at: new Date(now).toISOString(), outcome: "failed",
    mail_body: null, failure_reason: "retries exhausted: 500" });
  expect(outboxPatch(ticketOutcome({ sent: true }), 1, now)).toMatchObject({ outcome: "sent", failure_reason: null });
});
