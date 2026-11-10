import { afterEach, expect, it, vi } from "vitest";

const { admin, config } = vi.hoisted(() => ({ admin: vi.fn(), config: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: admin }));
vi.mock("stripe", () => ({ default: class {
  constructor(_key: string, options: unknown) { config(options); }
  static createFetchHttpClient(requestFetch: typeof fetch) { return requestFetch; }
} }));
const { recoveryContext } = await import("../context");
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

it("gives Stripe and the admin client the same bounded transport with no provider retries", async () => {
  const request = vi.fn().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", request);
  const context = recoveryContext();
  const transport = admin.mock.calls[0][0] as typeof fetch;
  expect(config).toHaveBeenCalledWith(expect.objectContaining({ maxNetworkRetries: 0, timeout: 1500, httpClient: transport }));
  expect(context.deadline - Date.now()).toBeLessThanOrEqual(10_000);
  const caller = new AbortController();
  await transport("https://example.test", { signal: caller.signal });
  const signal = request.mock.calls[0][1].signal as AbortSignal;
  expect(signal.aborted).toBe(false);
  caller.abort();
  expect(signal.aborted).toBe(true);
});

it("refuses further network requests after the job deadline", async () => {
  vi.useFakeTimers();
  const request = vi.fn();
  vi.stubGlobal("fetch", request);
  const context = recoveryContext();
  vi.setSystemTime(context.deadline);
  const transport = admin.mock.calls[0][0] as typeof fetch;
  await expect(transport("https://example.test")).rejects.toThrow("deadline");
  expect(request).not.toHaveBeenCalled();
});
