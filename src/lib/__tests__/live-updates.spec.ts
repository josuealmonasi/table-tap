import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { liveUpdatesEnabled } from "@/lib/supabase/live-updates";
import { sources, read } from "./invariants/helpers";

/**
 * The gate build turns realtime off to spare the dev database's disk I/O.
 * Production must never, and a screen that subscribes without asking would
 * put the cost straight back.
 */
describe("live updates", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are on unless the gate build turns them off", () => {
    vi.stubEnv("NEXT_PUBLIC_GATE_LIVE_UPDATES", "");
    expect(liveUpdatesEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_GATE_LIVE_UPDATES", "on");
    expect(liveUpdatesEnabled()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_GATE_LIVE_UPDATES", "off");
    expect(liveUpdatesEnabled()).toBe(false);
  });

  it("are asked about by every screen that subscribes to realtime", () => {
    const subscribers = sources.filter(f => read(f).includes("postgres_changes"));
    expect(subscribers.length).toBeGreaterThan(0);
    expect(subscribers.filter(f => !read(f).includes("liveUpdatesEnabled()"))).toEqual([]);
  });

  it("cannot be turned off in a Vercel build", () => {
    const config = fs.readFileSync("next.config.ts", "utf8");
    expect(config).toMatch(/process\.env\.VERCEL && process\.env\.NEXT_PUBLIC_GATE_LIVE_UPDATES === "off"[\s\S]{0,40}throw/);
  });
});
