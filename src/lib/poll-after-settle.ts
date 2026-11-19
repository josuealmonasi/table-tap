interface PollOptions {
  immediate?: boolean;
  pauseWhenHidden?: boolean;
  refreshOnVisible?: boolean;
  refreshOnFocus?: boolean;
}

interface SettlingPoll {
  refresh: () => Promise<void>;
  stop: () => void;
}

/** The longest one read may take before it counts as failed: twice the
 * interval, never under 15 s. A half-open connection can keep a fetch pending
 * for minutes, and the poll waits for its read to settle. */
export function readTimeoutMs(interval: number | null): number {
  return Math.max(2 * (interval ?? 0), 15_000);
}

/** Runs one read with an abort signal, and settles once the read does or its
 * time is up, whichever is first. A read that ignores the signal cannot
 * freeze the poll; one that passes it to `fetch` also frees the connection. */
function boundedRead(read: (signal: AbortSignal) => Promise<unknown>, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort(new DOMException("The read timed out.", "TimeoutError"));
      reject(new Error("The read timed out."));
    }, timeoutMs);
  });
  return Promise.race([Promise.resolve().then(() => read(controller.signal)), expired]).finally(() => clearTimeout(timer));
}

/** A slow read must finish before the next wait starts, including after a
 * refusal. A read that never answers fails after `readTimeoutMs(interval)`. */
export function pollAfterSettle(read: (signal: AbortSignal) => Promise<unknown>, interval: number | null, options: PollOptions = {}): SettlingPoll {
  let stopped = false;
  let running: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    clearTimeout(timer);
    if (options.pauseWhenHidden && document.visibilityState === "hidden") {
      schedule();
      return Promise.resolve();
    }
    running = Promise.resolve().then(() => stopped ? undefined : boundedRead(read, readTimeoutMs(interval))).then(() => {}, () => {
      // A failed read still gets another try; callers keep their last good answer.
    }).finally(() => {
      running = undefined;
      schedule();
    });
    return running;
  };
  function schedule(): void {
    if (!stopped && interval !== null) timer = setTimeout(() => void refresh(), interval);
  }
  const visible = () => { if (document.visibilityState === "visible") void refresh(); };
  if (options.refreshOnVisible) document.addEventListener("visibilitychange", visible);
  if (options.refreshOnFocus) window.addEventListener("focus", visible);
  if (options.immediate === false) schedule();
  else void refresh();
  return {
    refresh,
    stop(): void {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("focus", visible);
    },
  };
}

/** A signal that aborts when either does: a component's own unmount signal
 * plus the poll's per-read timeout. */
export function eitherSignal(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a;
  const controller = new AbortController();
  if (a.aborted || b.aborted) controller.abort((a.aborted ? a : b).reason);
  else {
    a.addEventListener("abort", () => controller.abort(a.reason), { once: true });
    b.addEventListener("abort", () => controller.abort(b.reason), { once: true });
  }
  return controller.signal;
}
