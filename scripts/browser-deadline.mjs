/** A timeout is a failure. Cleanup has its own ceiling; it cannot hide the first timeout. */
export async function deadline(ms, work, stop, cleanupTimeout = 5000, label = "work") {
  let timer;
  const task = Promise.resolve().then(work);
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })]);
  } catch (error) {
    // Promise.race observes late rejection too. Closing stops all browser work;
    // an uncooperative promise cannot keep a context alive or click another job.
    if (stop) {
      try { await deadline(cleanupTimeout, stop, undefined, cleanupTimeout, "context cleanup"); }
      catch (closeError) { throw new AggregateError([error, closeError], `${error.message}; context cleanup failed: ${closeError.message}`); }
    }
    throw error;
  } finally { clearTimeout(timer); }
}

export const RUN_TIMEOUT = 90 * 60 * 1000;

/** @type {(code: number) => void} */
const exitRun = code => { process.exit(code); };

/** Covers setup, controls, the pool, fingerprints and browser shutdown too. */
export function runWatchdog(name, {
  timeout = RUN_TIMEOUT, log = console.error, exit = exitRun,
} = {}) {
  const timer = setTimeout(() => {
    log(`BAD ${name}: whole run watchdog expired after ${timeout}ms; coverage is incomplete, run FAILED.`);
    exit(1);
  }, timeout);
  return () => clearTimeout(timer);
}
