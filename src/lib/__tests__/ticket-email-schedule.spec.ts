import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { outboxPatch } from "@/lib/ticket-email-retry";

it("N10: a cron retries after recovery within the ticket's 24-hour lifetime without traffic", () => {
  const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
  const schedule = crons.find((c: { path: string }) => c.path === "/api/cron/recover").schedule;
  const matches = (at: number) => {
    const date = new Date(at);
    const [minute, hour] = schedule.split(" ");
    return (minute.startsWith("*/") ? date.getUTCMinutes() % Number(minute.slice(2)) === 0 : date.getUTCMinutes() === Number(minute))
      && (hour === "*" || date.getUTCHours() === Number(hour));
  };
  const created = Date.parse("2026-11-10T15:00:00Z");
  const failedAt = created + 18 * 3600_000;
  const patch = outboxPatch({ outcome: "failed", retryable: true, reason: "503" }, 2, failedAt);
  const due = Date.parse(String(patch.next_attempt_at));
  const recovery = failedAt + 15 * 60_000;
  let sent = false;
  for (let at = failedAt + 60_000; at < created + 24 * 3600_000; at += 60_000) {
    if (matches(at) && at >= due && at >= recovery) { sent = true; break; }
  }
  expect(sent).toBe(true);
});
