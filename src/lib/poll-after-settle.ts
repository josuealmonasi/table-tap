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

/** A slow read must finish before the next wait starts, including after a refusal. */
export function pollAfterSettle(read: () => Promise<unknown>, interval: number | null, options: PollOptions = {}): SettlingPoll {
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
    running = Promise.resolve().then(() => stopped ? undefined : read()).then(() => {}, () => {
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
