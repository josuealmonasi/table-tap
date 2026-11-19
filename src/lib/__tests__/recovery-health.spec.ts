import { expect, it } from "vitest";
import { schedulerHealth } from "@/lib/recovery/health.mjs";

it("reports a missing, stale, or unreadable production scheduler and skips development", () => {
  const now = Date.parse("2026-11-17T12:00:00Z");
  expect(schedulerHealth(false, null, false, now)).toEqual({ ok: true, status: "skipped: no scheduler on dev" });
  expect(schedulerHealth(true, null, false, now).ok).toBe(false);
  expect(schedulerHealth(true, "2026-11-17T11:44:59Z", false, now).ok).toBe(false);
  expect(schedulerHealth(true, "2026-11-17T11:55:00Z", true, now).ok).toBe(false);
  expect(schedulerHealth(true, "2026-11-17T11:55:00Z", false, now).ok).toBe(true);
});
