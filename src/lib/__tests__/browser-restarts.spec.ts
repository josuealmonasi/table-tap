import { expect, it, vi } from "vitest";
import { runBrowserJobs } from "../../../scripts/browser-jobs.mjs";
import { listenerMemory, monitorBrowserServer } from "../../../scripts/browser-server.mjs";

const quiet = () => {};
const fakeBrowser = () => ({ newContext: vi.fn(async () => ({ newPage: async () => ({}), close: async () => {} })) });

for (const concurrency of [1, 2, 3]) {
  it(`retries a connection failure only once, with a fresh context, at concurrency ${concurrency}`, async () => {
    const server = monitorBrowserServer("http://localhost:3100", {
      inspect: async () => ({ online: true, pids: "1", rss: 0 }), log: quiet,
    });
    const browser = fakeBrowser();
    const run = vi.fn().mockRejectedValueOnce(new Error("net::ERR_CONNECTION_REFUSED"))
      .mockResolvedValue({ failures: 0 });
    const log = vi.fn();
    try {
      const result = await runBrowserJobs(browser, [{ id: "restarted", run }], { concurrency, server, log });
      expect(result.failures).toBe(0);
      expect(result.records[0].retries).toBe(1);
      expect(browser.newContext).toHaveBeenCalledTimes(2);
      expect(log.mock.calls.flat().join("\n")).toContain("RETRY");
    } finally { server.stop(); }
  });

  it(`a second connection failure stays red at concurrency ${concurrency}`, async () => {
    const server = monitorBrowserServer("http://localhost:3100", {
      inspect: async () => ({ online: true, pids: "1", rss: 0 }), log: quiet,
    });
    const run = vi.fn().mockRejectedValue(new Error("net::ERR_FAILED"));
    try {
      const result = await runBrowserJobs(fakeBrowser(), [{ id: "broken", run }], { concurrency, server, log: quiet });
      expect(result.failures).toBe(1);
      expect(run).toHaveBeenCalledTimes(2);
    } finally { server.stop(); }
  });
}

it("pauses new contexts until the server answers again, sharing one recovery wait", async () => {
  let online = true;
  let release: () => void = () => {};
  const recovered = new Promise<void>(resolve => { release = resolve; });
  const server = monitorBrowserServer("http://localhost:3100", {
    inspect: async () => ({ online, pids: online ? "1" : "", rss: 0 }),
    answers: async () => { await recovered; return true; }, interval: 5, recoveryTimeout: 500, log: quiet,
  });
  const browser = fakeBrowser();
  const run = vi.fn(async () => {
    if (run.mock.calls.length === 1) online = false;
    throw new Error("net::ERR_CONNECTION_RESET");
  });
  try {
    const work = runBrowserJobs(browser, [{ id: "first", run }, { id: "next", run: async () => ({ failures: 0 }) }],
      { concurrency: 1, server, log: quiet });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(browser.newContext).toHaveBeenCalledTimes(1);
    online = true;
    release();
    const result = await work;
    expect(result.failures).toBe(1);
    expect(result.records[1].verdict).toBe("passed");
    expect(run).toHaveBeenCalledTimes(2);
  } finally { server.stop(); }
});

it("retries readiness only with evidence of a restart, never an audit fault", async () => {
  let pid = "1";
  const server = monitorBrowserServer("http://localhost:3100", {
    inspect: async () => ({ online: true, pids: pid, rss: 0 }), log: quiet,
  });
  try {
    await server.beforeJob();
    const epoch = server.epoch;
    expect(await server.canRetry(new Error("page state did not become ready in 30000ms"), epoch)).toBe(false);
    // The server, not the page: it hung up, or produced nothing in time. On
    // an 8 GB Mac deep in swap these failed whole runs with no restart seen.
    expect(await server.canRetry(new Error("page.goto: net::ERR_EMPTY_RESPONSE at http://localhost:3000/dashboard/profile"), epoch)).toBe(true);
    expect(await server.canRetry(new Error("page.goto: Timeout 60000ms exceeded."), epoch)).toBe(true);
    // A control that never answers is the page's fault; it is not retried.
    expect(await server.canRetry(new Error("locator.click: Timeout 30000ms exceeded."), epoch)).toBe(false);
    pid = "2";
    expect(await server.canRetry(new Error("page state did not become ready in 30000ms"), epoch)).toBe(true);
    expect(await server.canRetry(new Error("unexpected route /login"), epoch)).toBe(false);
    expect(await server.canRetry(new Error("audit overlap"), epoch)).toBe(false);
    const run = vi.fn(async ({ log }: { log: (text: string) => void }) => {
      log("    BAD      planted overlap");
      throw new Error("net::ERR_CONNECTION_REFUSED");
    });
    const result = await runBrowserJobs(fakeBrowser(), [{ id: "overlap before restart", run }], { server, log: quiet });
    expect(result.failures).toBe(1);
    expect(run).toHaveBeenCalledOnce();
  } finally { server.stop(); }
});

it("a server that never recovers fails all visits within its bounded recovery window", async () => {
  const server = monitorBrowserServer("http://localhost:3100", {
    inspect: async () => ({ online: false, pids: "", rss: 0 }), interval: 2, recoveryTimeout: 10, log: quiet,
  });
  const browser = fakeBrowser();
  try {
    const result = await runBrowserJobs(browser, [{ id: "down", run: async () => ({ failures: 0 }) }], { server, log: quiet });
    expect(result.failures).toBe(1);
    expect(browser.newContext).not.toHaveBeenCalled();
  } finally { server.stop(); }
});

it("samples RSS only from the target port's listener and reports the peak across restarts", async () => {
  const run = vi.fn().mockResolvedValueOnce({ stdout: "21\n12\n21\n" })
    .mockResolvedValueOnce({ stdout: "12 2048\n21 4096\n999 999999\n" });
  expect(await listenerMemory("http://localhost:3107", run)).toEqual({ pids: "12,21", pid: 21, rss: 4096 });
  expect(run.mock.calls[0][1]).toContain("-iTCP:3107");
  expect(run.mock.calls[1][1]).toEqual(["-o", "pid=,rss=", "-p", "12,21"]);
  const log = vi.fn();
  let rss = 4096;
  const server = monitorBrowserServer("http://localhost:3107", {
    inspect: async () => ({ online: true, pids: "21", pid: 21, rss }), log,
  });
  try {
    await server.beforeJob();
    rss = 1024;
    await server.beforeJob();
    server.report();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("4.0 MiB (pid 21)"));
  } finally { server.stop(); }
});

it("shares recovery between concurrent workers and admits no contexts while down", async () => {
  let online = false;
  let release: () => void = () => {};
  const recovered = new Promise<void>(resolve => { release = resolve; });
  const answers = vi.fn(async () => { await recovered; return true; });
  const server = monitorBrowserServer("http://localhost:3100", {
    inspect: async () => ({ online, pids: online ? "1" : "", rss: 0 }),
    answers, interval: 5, recoveryTimeout: 500, log: quiet,
  });
  const browser = fakeBrowser();
  try {
    const jobs = ["a", "b", "c"].map(id => ({ id, run: async () => ({ failures: 0 }) }));
    const work = runBrowserJobs(browser, jobs, { concurrency: 3, server, log: quiet });
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(browser.newContext).not.toHaveBeenCalled();
    online = true;
    await new Promise(resolve => setTimeout(resolve, 15));
    expect(browser.newContext).not.toHaveBeenCalled();
    expect(answers).toHaveBeenCalledOnce();
    release();
    expect((await work).failures).toBe(0);
    expect(browser.newContext).toHaveBeenCalledTimes(3);
  } finally { server.stop(); }
});
