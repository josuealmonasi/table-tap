import { deadline } from "./browser-deadline.mjs";

/** Bound setup and teardown as well as the page work. A dead CDP call must report. */
export async function browserVisit(browser, job, {
  timeout, stepTimeout, cleanupTimeout, prepare, phase, log, signal,
}) {
  let ctx;
  let closing;
  let stopped = false;
  let cleanupFailed = false;
  const close = () => {
    stopped = true;
    return closing ??= deadline(cleanupTimeout, () => ctx?.close(), undefined, cleanupTimeout, "context close")
      .catch(error => { cleanupFailed = true; throw error; });
  };
  const step = (name, work) => {
    if (stopped) throw new Error(`visit stopped before ${name}`);
    return deadline(stepTimeout, async () => {
      const value = await work();
      if (stopped) throw new Error(`visit stopped during ${name}`);
      return value;
    }, close, cleanupTimeout, name);
  };
  let result;
  let error;
  let rejectAbort;
  const abort = () => { stopped = true; rejectAbort(new Error("pool stopped before visit reported")); };
  const cancelled = new Promise((_, reject) => { rejectAbort = reject; });
  signal?.addEventListener("abort", abort, { once: true });
  try {
    result = await deadline(job.timeout ?? timeout, () => Promise.race([cancelled, (async () => {
      ctx = await step("context creation", async () => {
        const created = await browser.newContext(job.options);
        if (stopped) {
          await deadline(cleanupTimeout, () => created.close(), undefined, cleanupTimeout, "late context close");
          throw new Error("context arrived after visit timeout");
        }
        return created;
      });
      await step("visit preparation", () => prepare(ctx, job));
      const tab = await step("page creation", () => ctx.newPage());
      return await job.run({ ctx, tab, log, phase: (name, work) => step(name, () => phase(name, work)), stop: close });
    })()]), close, cleanupTimeout, `visit ${job.id}`);
    if (!Number.isInteger(result?.failures) || result.failures < 0) throw new Error("visit returned without a verdict");
  } catch (failure) { error = failure; }
  finally {
    signal?.removeEventListener("abort", abort);
    try { await close(); }
    catch (failure) { error = failure; }
  }
  return { result, error, cleanupFailed };
}
