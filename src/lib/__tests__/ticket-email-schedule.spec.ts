import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { outboxPatch } from "@/lib/ticket-email-retry";

it.each([0, 2 * 3600_000])("N10: scheduled retries survive a %s ms runner delay within the 24-hour lifetime without traffic", delay => {
  const { crons } = JSON.parse(readFileSync("vercel.json", "utf8"));
  const fallback = crons.find((c: { path: string }) => c.path === "/api/cron/recover").schedule;
  const workflow = readFileSync(".github/workflows/recovery.yml", "utf8");
  const frequent = /cron: "([^"]+)"/.exec(workflow)?.[1];
  expect(frequent).toBeDefined();
  const matchesField = (field: string, value: number) => {
    const [base, step] = field.split("/");
    const [start, end] = base === "*" ? [0, 59] : base.includes("-") ? base.split("-").map(Number) : [Number(base), Number(base)];
    return value >= start && value <= end && (value - start) % Number(step ?? 1) === 0;
  };
  const matches = (at: number) => {
    return [fallback, frequent!].some(schedule => {
      const date = new Date(at - (schedule === frequent ? delay : 0));
      const [minute, hour] = schedule.split(" ");
      return matchesField(minute, date.getUTCMinutes()) && matchesField(hour, date.getUTCHours());
    });
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
