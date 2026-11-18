import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { outboxPatch } from "@/lib/ticket-email-retry";

// N10, corrected by the audit of #648. GitHub's "every five minutes" ran 8
// times in two days, 3.5 to 10 hours apart: it drops scheduled runs, so it
// guarantees nothing and this model does not count it. The guarantee comes
// from the daily Vercel cron plus the database's own five-minute pg_cron job.
const schema = readFileSync("supabase/schema.sql", "utf8");
const daily: string = JSON.parse(readFileSync("vercel.json", "utf8"))
  .crons.find((c: { path: string }) => c.path === "/api/cron/recover").schedule;
const database = /cron\.schedule\('tabletap-recover', '([^']+)'/.exec(schema.slice(schema.lastIndexOf("cron.schedule('tabletap-recover'")))?.[1];
const LIFETIME = 24 * 3600_000;
/** A failure must be at least this old before a run counts (a lapsed claim is five minutes; this is generous). */
const SETTLE = 15 * 60_000;

function fieldMatches(field: string, value: number, max: number): boolean {
  return field.split(",").some(part => {
    const [base, step] = part.split("/");
    const [start, end] = base === "*" ? [0, max] : base.includes("-") ? base.split("-").map(Number) : [Number(base), step ? max : Number(base)];
    return value >= start && value <= end && (value - start) % Number(step ?? 1) === 0;
  });
}
function fires(schedule: string, at: number): boolean {
  const [minute, hour, day, month, weekday] = schedule.split(" ");
  expect([day, month, weekday]).toEqual(["*", "*", "*"]);
  const date = new Date(at);
  return fieldMatches(minute, date.getUTCMinutes(), 59) && fieldMatches(hour, date.getUTCHours(), 23);
}
/** The first guaranteed run that may retry this failure, or null if none before the ticket expires. */
function nextRetry(created: number, failedAt: number, attempts: number): { at: number; due: number } | null {
  const due = Date.parse(String(outboxPatch({ outcome: "failed", retryable: true, reason: "503" }, attempts, failedAt).next_attempt_at));
  for (let at = Math.ceil((failedAt + 1) / 60_000) * 60_000; at < created + LIFETIME; at += 60_000) {
    if (at >= due && at >= failedAt + SETTLE && [daily, database!].some(schedule => fires(schedule, at))) return { at, due };
  }
  return null;
}

describe("N10: ticket retries run before the ticket expires, without new traffic", () => {
  it("the database schedules the recovery every five minutes", () => {
    expect(database).toBe("*/5 * * * *");
  });

  it("the audit's scenario: created 15:00, third failure 18 h later, retried long before 15:00 next day", () => {
    const created = Date.parse("2026-11-10T15:00:00Z");
    const retry = nextRetry(created, created + 18 * 3600_000, 3);
    expect(retry).not.toBeNull();
    // Due at 10:00 (an hour's backoff); the five-minute job takes it then.
    expect(retry!.at - retry!.due).toBeLessThanOrEqual(5 * 60_000);
  });

  it.each([1, 2, 3])("every retry after failure %i, at any minute of the day, runs within 15 minutes of due", attempts => {
    const created = Date.parse("2026-11-10T00:00:00Z");
    for (let failedAt = created; failedAt < created + LIFETIME; failedAt += 7 * 60_000) {
      const retry = nextRetry(created, failedAt, attempts);
      const due = Date.parse(String(outboxPatch({ outcome: "failed", retryable: true, reason: "503" }, attempts, failedAt).next_attempt_at));
      // A retry due after the lifetime ends expires by design, not by a missed schedule.
      if (Math.max(due, failedAt + SETTLE) + 5 * 60_000 >= created + LIFETIME) continue;
      expect(retry, new Date(failedAt).toISOString()).not.toBeNull();
      expect(retry!.at - Math.max(due, failedAt + SETTLE)).toBeLessThan(5 * 60_000);
    }
  });

  it("the daily Vercel cron alone is not the guarantee, which is why the database job exists", () => {
    // A ticket that fails just before the daily run waits a whole day: past its lifetime.
    const created = Date.parse("2026-11-10T08:50:00Z");
    const failedAt = created + 60_000;
    const due = Date.parse(String(outboxPatch({ outcome: "failed", retryable: true, reason: "503" }, 1, failedAt).next_attempt_at));
    let dailyOnly: number | null = null;
    for (let at = failedAt + 60_000; at < created + LIFETIME; at += 60_000) {
      if (at >= due && at >= failedAt + SETTLE && fires(daily, at)) { dailyOnly = at; break; }
    }
    expect(dailyOnly).toBeNull();
    expect(nextRetry(created, failedAt, 1)).not.toBeNull();
  });
});
