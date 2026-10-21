import { deadline, RUN_TIMEOUT } from "./browser-deadline.mjs";
import { browserVisit } from "./browser-visit.mjs";
export { deadline } from "./browser-deadline.mjs";

/** One browser, bounded isolated visits, and an explicit verdict for every job. */
export function browserConcurrency(value = process.env.GATE_BROWSER_CONCURRENCY) {
  if (value === undefined) return 2;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new Error("GATE_BROWSER_CONCURRENCY must be an integer from 1 to 4");
  }
  return n;
}

export function phaseTimings() {
  const totals = { navigation: 0, readiness: 0, audit: 0, auth: 0 };
  return {
    totals,
    async phase(name, work) {
      const start = performance.now();
      try { return await deadline(name === "navigation" ? 65000 : 60000, work, undefined, 5000, name); }
      finally { totals[name] += performance.now() - start; }
    },
    report(log = console.log) {
      log(`  Phase totals (worker seconds): ${Object.entries(totals).map(([k, v]) => `${k}=${(v / 1000).toFixed(2)}s`).join(", ")}`);
    },
  };
}

export function manifestFailures(records) {
  return records.reduce((n, record) => n + (record.verdict === "passed" || record.verdict === "skipped"
    ? 0 : Math.max(1, record.result?.failures ?? 0)), 0);
}

export async function runBrowserJobs(browser, jobs, {
  concurrency = browserConcurrency(), timeout = 180000, prepare = async () => {},
  log = console.log, timings = phaseTimings(), stepTimeout = 65000, cleanupTimeout = 5000,
  overallTimeout = RUN_TIMEOUT,
  server = /** @type {ReturnType<typeof import("./browser-server.mjs").monitorBrowserServer> | null} */ (null),
} = {}) {
  concurrency = browserConcurrency(concurrency);
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("duplicate browser job id");
  const records = jobs.map(job => ({ id: job.id, verdict: "pending", complete: false, lines: [], result: null, retries: 0 }));
  let next = 0;
  let printed = 0;
  let aborted = false;
  const controller = new AbortController();
  const flush = () => {
    while (printed < records.length && records[printed].complete) log(records[printed++].lines.join("\n"));
  };
  async function worker() {
    while (!aborted && next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      const record = records[index];
      const line = text => { if (!record.complete) record.lines.push(text); };
      try {
        if (job.skip) {
          line(`    –        ${job.id}: ${job.skip}`);
          record.verdict = "skipped";
        } else {
          for (let attempt = 0; attempt < 2; attempt++) {
            // All workers share the recovery wait. None starts a new context while down.
            await server?.beforeJob();
            if (aborted) return;
            const epoch = server?.epoch;
            let auditFailed = false;
            const visit = await browserVisit(browser, job, {
              timeout, stepTimeout, cleanupTimeout, prepare, phase: timings.phase, signal: controller.signal,
              log: text => { if (/^\s*BAD\s/.test(text)) auditFailed = true; line(text); },
            });
            if (aborted) return;
            if (visit.cleanupFailed) { aborted = true; controller.abort(); } // An unclosed context must not leak into another visit.
            if (!visit.error) {
              record.result = visit.result;
              record.verdict = visit.result.failures ? "failed" : "passed";
              break;
            }
            line(`    BAD      ${job.id}: ${visit.error.message.split("\n")[0]}`);
            if (attempt || auditFailed || visit.cleanupFailed || !await server?.canRetry(visit.error, epoch)) throw visit.error;
            record.retries++;
            // Print immediately too: ordered buffering must not conceal a recovery wait.
            log(`    RETRY    ${job.id}: connection/restart failure; retry 1/1 in a fresh context`);
            line(`    RETRY    ${job.id}: retry 1/1`);
          }
        }
      } catch (error) {
        line(`    BAD      ${job.id}: ${error.message.split("\n")[0]}`);
        record.verdict = "failed";
      } finally {
        if (!record.complete && record.verdict !== "pending") {
          record.lines.push(`    ${record.verdict.toUpperCase()} visit ${job.id}`);
          record.complete = true;
          flush();
        }
      }
    }
  }
  try {
    await deadline(overallTimeout, () => Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker)),
      undefined, cleanupTimeout, "browser pool watchdog");
  } catch (error) {
    aborted = true;
    controller.abort();
    log(`    BAD      ${error.message}; unfinished visits FAILED`);
  }
  const missing = records.filter(record => record.verdict === "pending").length;
  for (const record of records) if (record.verdict === "pending") {
    record.verdict = "failed";
    record.complete = true;
    record.lines.push(`    BAD      ${record.id}: job never reported before pool stopped`);
  }
  flush();
  const failures = manifestFailures(records);
  log(`  Visits: planned=${records.length}, passed=${records.filter(r => r.verdict === "passed").length}, failed=${records.filter(r => r.verdict === "failed").length}, skipped=${records.filter(r => r.verdict === "skipped").length}, missing=${missing}, retries=${records.reduce((n, r) => n + r.retries, 0)}`);
  return { records, failures };
}
