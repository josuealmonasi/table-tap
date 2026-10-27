import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ready, trackData } from "../../../scripts/browser-ready.mjs";

const source = readFileSync(new URL("../../../scripts/promise-audit.mjs", import.meta.url), "utf8");
const team = source.slice(source.indexOf("  for (const path of who.pages)"), source.indexOf("  // Every link"));
const diner = source.slice(source.indexOf("for (const [name, path] of ["), source.indexOf("await guest.close()"));

class SlowPage extends EventEmitter {
  hydrated = false;
  closed = false;
  path = "";
  audits = vi.fn(() => [{ title: "Missing empty state" }]);
  url() { return this.path; }
  isClosed() { return this.closed; }
  async goto(path: string) {
    this.path = path;
    const request = { resourceType: () => "fetch" };
    this.emit("request", request);
    setTimeout(() => { this.hydrated = true; this.emit("requestfinished", request); }, 2500);
  }
  async waitForTimeout(ms: number) { await new Promise(resolve => setTimeout(resolve, ms)); }
  async evaluate(script: string) {
    if (script === "AUDIT") return this.hydrated ? this.audits() : [];
    if (script === "LINKS") return [];
    return { ready: this.hydrated, signature: "stable content" };
  }
  async close() { this.closed = true; }
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it.each([["team", team, 1], ["diner", diner, 2]] as const)(
  "%s audits every planned visit after slow browser data resolves", async (_name, loop, count) => {
    expect(loop).toContain("const holes = await tab.evaluate(AUDIT)");
    const pages: SlowPage[] = [];
    const context = { newPage: async () => { const page = new SlowPage(); pages.push(page); return page; } };
    const ok = vi.fn(), bad = vi.fn();
    const work = runInNewContext(`(async () => { ${loop} })()`, {
      ctx: context, guest: context, who: { pages: ["/dashboard/orders"], role: "owner" },
      BASE: "http://localhost:3100", restaurant: { id: "restaurant" }, table: { id: "table" },
      AUDIT: "AUDIT", DASHBOARD_LINKS: "LINKS", linked: new Set(),
      pageInScope: () => true, pathOf: (path: string) => path,
      URL, ok, bad, ready, trackData,
    });
    await vi.advanceTimersByTimeAsync(2000);
    // The old 1.8s sleep declared the skeleton honest before its data arrived.
    expect(ok).not.toHaveBeenCalled();
    expect(bad).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6000);
    await work;
    expect(pages).toHaveLength(count);
    expect(pages.every(page => page.audits.mock.calls.length === 1 && page.closed)).toBe(true);
    expect(ok).not.toHaveBeenCalled();
    expect(bad).toHaveBeenCalledTimes(count);
    expect(bad.mock.calls.every(([message]) => message.includes("Missing empty state"))).toBe(true);
  },
);
