import { expect, it, vi } from "vitest";
import { runBrowserJobs } from "../../../scripts/browser-jobs.mjs";

const never = () => new Promise<never>(() => {});
const quiet = () => {};

for (const concurrency of [1, 3]) {
  for (const hangs of ["newContext", "newPage", "prepare", "auth", "navigation", "readiness", "audit", "close"]) {
    it(`fails a never-settling ${hangs} at concurrency ${concurrency}`, async () => {
      const context = { newPage: hangs === "newPage" ? never : async () => ({}),
        close: hangs === "close" ? never : vi.fn(async () => {}) };
      const browser = { newContext: hangs === "newContext" ? never : async () => context };
      const run = async ({ phase }: { phase: (name: string, work: typeof never) => Promise<unknown> }) => {
        if (["auth", "navigation", "readiness", "audit"].includes(hangs)) await phase(hangs, never);
        return { failures: 0 };
      };
      const work = runBrowserJobs(browser, [{ id: hangs, run }],
        { concurrency, timeout: 10, cleanupTimeout: 10, stepTimeout: 10,
          prepare: hangs === "prepare" ? never : async () => {}, log: quiet });
      const outcome = await Promise.race([work, new Promise<null>(resolve => setTimeout(() => resolve(null), 150))]);
      expect(outcome, "a stuck browser call must return a failed manifest").not.toBeNull();
      expect(outcome?.failures).toBe(1);
      expect(outcome?.records[0].verdict).toBe("failed");
    });
  }
}

it("the pool watchdog fails both stuck and unstarted manifest entries", async () => {
  const close = vi.fn(async () => {});
  const browser = { newContext: async () => ({ newPage: async () => ({}), close }) };
  const log = vi.fn();
  const result = await runBrowserJobs(browser, [
    { id: "stuck", run: never }, { id: "never started", run: never },
  ], { concurrency: 1, timeout: 1000, overallTimeout: 10, cleanupTimeout: 10, log });
  expect(result.failures).toBe(2);
  expect(result.records.every((r: { verdict: string }) => r.verdict === "failed")).toBe(true);
  expect(log.mock.calls.flat().join("\n")).toContain("watchdog");
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(close).toHaveBeenCalledOnce();
});

it("the whole-run watchdog exits red even outside the pool", async () => {
  const { runWatchdog } = await import("../../../scripts/browser-deadline.mjs");
  const exit = vi.fn();
  const log = vi.fn();
  const stop = runWatchdog("setup stuck", { timeout: 10, exit, log });
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  expect(log).toHaveBeenCalledWith(expect.stringContaining("coverage is incomplete"));
  stop();
});

it("closes a context that arrives after its visit already failed", async () => {
  let deliver: (value: unknown) => void = () => {};
  const close = vi.fn(async () => {});
  const browser = { newContext: () => new Promise(resolve => { deliver = resolve; }) };
  const run = vi.fn(async () => ({ failures: 0 }));
  const result = await runBrowserJobs(browser, [{ id: "late context", run }], { timeout: 10, log: quiet });
  expect(result.failures).toBe(1);
  deliver({ close });
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(close).toHaveBeenCalledOnce();
  expect(run).not.toHaveBeenCalled();
});

it("does not enter a visit when page creation resolves after the job timed out", async () => {
  let deliver: (page: object) => void = () => {};
  const newPage = () => new Promise(resolve => { deliver = resolve; });
  const run = vi.fn(async () => ({ failures: 0 }));
  const browser = { newContext: async () => ({ newPage, close: async () => {} }) };
  const result = await runBrowserJobs(browser, [{ id: "late page", run }], { timeout: 10, log: quiet });
  expect(result.failures).toBe(1);
  deliver({});
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(run).not.toHaveBeenCalled();
});
