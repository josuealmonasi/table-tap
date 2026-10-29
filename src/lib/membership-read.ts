/** A stalled reply must release the poll latch, including while reading its body. */
export async function membershipRead<T>(url: string, options: RequestInit = {}): Promise<T> {
  return membershipDeadline(async signal => {
    const res = await fetch(url, { ...options, signal });
    if (!res.ok) throw new Error("Admission request refused");
    return await res.json() as T;
  }, options.signal);
}

/** Waiting for another tab's lock counts too: no fetch has started to abort yet. */
export async function membershipDeadline<T>(read: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal | null): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted) controller.abort();
  const deadline = setTimeout(cancel, 20_000);
  try {
    controller.signal.throwIfAborted();
    return await read(controller.signal);
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", cancel);
  }
}
