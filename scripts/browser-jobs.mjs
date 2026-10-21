/** One browser, bounded isolated visits, and an explicit verdict for every job. */
export function browserConcurrency(value = process.env.GATE_BROWSER_CONCURRENCY) {
  if (value === undefined) return 3;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 4) {
    throw new Error("GATE_BROWSER_CONCURRENCY must be an integer from 1 to 4");
  }
  return n;
}

/** A timeout is a failure. Close its context before another visit can start. */
export async function deadline(ms, work, stop) {
  let timer;
  const task = Promise.resolve().then(work);
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
    })]);
  } catch (error) {
    // Promise.race observes late rejection too. Closing stops all browser work;
    // an uncooperative promise cannot keep a context alive or click another job.
    try { await stop(); }
    catch (closeError) { throw new AggregateError([error, closeError], "work and context cleanup failed"); }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function phaseTimings() {
  const totals = { navigation: 0, readiness: 0, audit: 0, auth: 0 };
  return {
    totals,
    async phase(name, work) {
      const start = performance.now();
      try { return await work(); }
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
  log = console.log, timings = phaseTimings(),
} = {}) {
  concurrency = browserConcurrency(concurrency);
  if (new Set(jobs.map(job => job.id)).size !== jobs.length) throw new Error("duplicate browser job id");
  const records = jobs.map(job => ({ id: job.id, verdict: "pending", complete: false, lines: [], result: null }));
  let next = 0;
  let printed = 0;
  const flush = () => {
    while (printed < records.length && records[printed].complete) {
      const r = records[printed++];
      log(r.lines.join("\n"));
    }
  };
  async function worker() {
    while (next < jobs.length) {
      const index = next++;
      const job = jobs[index];
      const record = records[index];
      let ctx;
      let closing;
      let stopped = false;
      const close = () => {
        stopped = true;
        return closing ??= Promise.resolve().then(() => ctx?.close());
      };
      const line = text => { if (record.verdict === "pending") record.lines.push(text); };
      try {
        if (job.skip) {
          line(`    –        ${job.id}: ${job.skip}`);
          record.verdict = "skipped";
        } else {
          record.result = await deadline(job.timeout ?? timeout, async () => {
            ctx = await browser.newContext(job.options);
            if (stopped) { await ctx.close(); throw new Error("context arrived after visit timeout"); }
            await prepare(ctx, job);
            if (stopped) throw new Error("visit stopped during setup");
            const tab = await ctx.newPage();
            if (stopped) throw new Error("visit stopped while creating its page");
            return await job.run({ ctx, tab, log: line, phase: timings.phase, stop: close });
          }, close);
          if (!Number.isInteger(record.result?.failures) || record.result.failures < 0) {
            throw new Error("visit returned without a verdict");
          }
          await close();
          record.verdict = record.result.failures ? "failed" : "passed";
        }
      } catch (error) {
        line(`    BAD      ${job.id}: ${error.message.split("\n")[0]}`);
        record.verdict = "failed";
      } finally {
        try { await close(); }
        catch (error) {
          record.lines.push(`    BAD      ${job.id}: cleanup failed: ${error.message}`);
          record.verdict = "failed";
        }
        record.lines.push(`    ${record.verdict.toUpperCase()} visit ${job.id}`);
        record.complete = true;
        flush();
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  const failures = manifestFailures(records);
  log(`  Visits: planned=${records.length}, passed=${records.filter(r => r.verdict === "passed").length}, failed=${records.filter(r => r.verdict === "failed").length}, skipped=${records.filter(r => r.verdict === "skipped").length}, missing=${records.filter(r => r.verdict === "pending").length}`);
  return { records, failures };
}
