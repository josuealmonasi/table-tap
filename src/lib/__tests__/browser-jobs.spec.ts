import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { browserConcurrency, manifestFailures, phaseTimings, runBrowserJobs } from "../../../scripts/browser-jobs.mjs";
import { AUDIT } from "../../../scripts/layout-audit.mjs";
import { assertAuditControl, look } from "../../../scripts/browser-audit.mjs";
import { devWorkers } from "../../../scripts/preflight.mjs";

/** Execute the real audit against two fake DOM boxes with planted geometry. */
function plantedOverlap() {
  const body = {};
  const elements = ["PLANTED ALPHA TEXT", "PLANTED BETA TEXT"].map((text, i) => {
    const rect = { x: i * 30, y: i * 6, left: i * 30, top: i * 6,
      width: 240, height: 40, right: i * 30 + 240, bottom: i * 6 + 40 };
    return { textContent: text, childNodes: [{ nodeType: 3, textContent: text }],
      parentElement: body, classList: { contains: () => false },
      getBoundingClientRect: () => rect, getClientRects: () => [rect],
      contains: () => false, querySelectorAll: () => [],
    };
  });
  return runInNewContext(AUDIT, {
    document: { body, querySelectorAll: () => elements, documentElement: { scrollWidth: 390 } },
    window: { innerWidth: 390 },
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1",
      clip: "auto", clipPath: "none", position: "static" }),
  }) as { kind: string; text: string; w: number }[];
}

class FakePage {
  closed = false;
  clicks = 0;
  async close() { this.closed = true; }
  async setContent() { /* The fake DOM has the planted boxes above. */ }
  async evaluate() { return plantedOverlap(); }
  async click() {
    if (this.closed) throw new Error("page closed");
    this.clicks++;
  }
}

function fakeBrowser() {
  const pages: FakePage[] = [];
  let active = 0;
  let peak = 0;
  return {
    pages,
    get peak() { return peak; },
    async newContext() {
      const page = new FakePage();
      pages.push(page);
      active++;
      peak = Math.max(active, peak);
      let closed = false;
      return { newPage: async () => page, close: async () => {
        if (!closed) active--;
        closed = true;
        await page.close();
      } };
    },
  };
}
interface FakeVisit {
  tab: FakePage;
  log: (line: string) => void;
  phase: ReturnType<typeof phaseTimings>["phase"];
}
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

for (const concurrency of [1, 3]) describe(`browser pool at concurrency ${concurrency}`, () => {
  it("fails a throwing visit and still reports every planned visit", async () => {
    const browser = fakeBrowser();
    const { records, failures } = await runBrowserJobs(browser, [
      { id: "throws", run: async () => { throw new Error("navigation or typing failed"); } },
      { id: "later", run: async () => ({ failures: 0 }) },
    ], { concurrency, log: () => {} });
    expect(failures).toBe(1);
    expect(records.map((r: { verdict: string }) => r.verdict)).toEqual(["failed", "passed"]);
    expect(browser.pages.every(p => p.closed)).toBe(true);
  });

  it("fails a hanging visit, stops its context, and prevents its delayed click", async () => {
    const browser = fakeBrowser();
    const { failures, records } = await runBrowserJobs(browser, [
      { id: "hangs", timeout: 10, run: async ({ tab }: FakeVisit) => {
        await pause(40);
        await tab.click();
        return { failures: 0 };
      } },
      { id: "later", run: async () => ({ failures: 0 }) },
    ], { concurrency, log: () => {} });
    await pause(50);
    expect(failures).toBe(1);
    expect(records[0].lines.join("\n")).toContain("timed out");
    expect(browser.pages[0].closed).toBe(true);
    expect(browser.pages[0].clicks).toBe(0);
    expect(records[1].verdict).toBe("passed");
  });

  it("cannot hide a planted overlap from the real audit", async () => {
    const browser = fakeBrowser();
    const { failures } = await runBrowserJobs(browser, [{ id: "overlap", run: async ({ tab, log, phase }: FakeVisit) => ({
      failures: await look(tab, "planted overlap", phase, log),
    }) }], { concurrency, log: () => {} });
    expect(plantedOverlap().some(f => f.kind === "overlapping")).toBe(true);
    expect(failures).toBeGreaterThan(0);
  });

  it("bounds isolated contexts and prints completed jobs in original order", async () => {
    const browser = fakeBrowser();
    const lines: string[] = [];
    const jobs = Array.from({ length: 5 }, (_, n) => ({ id: String(n), run: async ({ log }: FakeVisit) => {
      log(`start ${n}`);
      await pause(n === 0 ? 20 : 1);
      log(`end ${n}`);
      return { failures: 0 };
    } }));
    const { failures } = await runBrowserJobs(browser, jobs, { concurrency, log: s => { lines.push(s); } });
    expect(failures).toBe(0);
    expect(browser.peak).toBe(concurrency);
    for (let n = 0; n < 5; n++) expect(lines[n]).toBe(`start ${n}\nend ${n}\n    PASSED visit ${n}`);
    expect(browser.pages.every(p => p.closed)).toBe(true);
  });
});

it("fails jobs that return without a verdict and detects missing manifest entries", async () => {
  const result = await runBrowserJobs(fakeBrowser(), [{ id: "forgotten", run: async () => undefined }], { log: () => {} });
  expect(result.failures).toBe(1);
  expect(manifestFailures([{ verdict: "pending" }])).toBe(1);
});

it("closes the positive control and refuses an audit that no longer catches overlap", async () => {
  const close = vi.fn();
  const browser = { newContext: async () => ({ close, newPage: async () => ({ setContent: async () => {}, evaluate: async () => [] }) }) };
  await expect(assertAuditControl(browser)).rejects.toThrow("no longer sees text painted over text");
  expect(close).toHaveBeenCalledOnce();
});

it("defaults to two workers and rejects concurrency outside 1–4", () => {
  expect(browserConcurrency("3")).toBe(3);
  vi.stubEnv("GATE_BROWSER_CONCURRENCY", undefined);
  expect(browserConcurrency()).toBe(2);
  vi.unstubAllEnvs();
  for (const n of ["0", "5", "1.5", "garbage", ""]) expect(() => browserConcurrency(n)).toThrow();
});

it("records phase time even when a check fails", async () => {
  const timings = phaseTimings();
  await expect(timings.phase("audit", async () => { await pause(1); throw new Error("failed"); })).rejects.toThrow("failed");
  expect(timings.totals.audit).toBeGreaterThan(0);
});

it("looks up only the server port, including localhost's default port", () => {
  const run = vi.fn((...args: unknown[]) => { void args; return "200\n100\n200\n"; });
  expect(devWorkers("http://localhost:3100", run)).toBe("100,200");
  expect(run.mock.calls[0]).toEqual(["lsof", ["-nP", "-iTCP:3100", "-sTCP:LISTEN", "-t"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }]);
  run.mockClear();
  expect(devWorkers("https://example.com", run)).toBeNull();
  expect(run).not.toHaveBeenCalled();
  devWorkers("http://localhost", run);
  expect(run.mock.calls[0][1]).toContain("-iTCP:80");
});
