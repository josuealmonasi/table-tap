import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { jobs, context } = vi.hoisted(() => ({ jobs: { stock: vi.fn(), refunds: vi.fn(), fees: vi.fn(), subscriptions: vi.fn() }, context: vi.fn() }));
vi.mock("../context", () => ({ recoveryContext: context }));
vi.mock("../stock", () => ({ recoverStock: jobs.stock }));
vi.mock("../refunds", () => ({ recoverRefunds: jobs.refunds }));
vi.mock("../fees", () => ({ recoverFees: jobs.fees }));
vi.mock("../subscriptions", () => ({ recoverSubscriptions: jobs.subscriptions }));
const { GET } = await import("@/app/api/cron/recover/route");
const clean = { done: 0, pending: 0, failed: 0, oldest_pending_at: null, oldest_pending_age_seconds: null, age_basis: "created_at" };
const request = (authorization?: string) => new NextRequest("https://test/api/cron/recover", {
  headers: authorization === undefined ? {} : { authorization },
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  context.mockReturnValue({});
  Object.values(jobs).forEach(job => job.mockResolvedValue(clean));
});
afterEach(() => vi.unstubAllEnvs());

it.each([undefined, "", "Bearer wrong", "Bearer cron-test-secreu", "Basic cron-test-secret", "bearer cron-test-secret"])(
  "refuses an unauthorized cron request (%s) before making any client", async authorization => {
    expect((await GET(request(authorization))).status).toBe(401);
    expect(context).not.toHaveBeenCalled();
    Object.values(jobs).forEach(job => expect(job).not.toHaveBeenCalled());
  },
);
it.each([undefined, ""])("refuses a missing or empty configured secret (%s)", async secret => {
  vi.stubEnv("CRON_SECRET", secret);
  expect((await GET(request(`Bearer ${secret ?? ""}`))).status).toBe(401);
  expect(context).not.toHaveBeenCalled();
});
it("runs every job without a user session and returns uncached per-job counts", async () => {
  const result = await GET(request("Bearer cron-test-secret"));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(await result.json()).toEqual({ jobs: { stock: clean, refunds: clean, fees: clean, subscriptions: clean } });
  expect(context).toHaveBeenCalledTimes(4);
});
it("a failed job cannot prevent the other three jobs from running", async () => {
  jobs.stock.mockRejectedValue(new Error("database unavailable"));
  const result = await GET(request("Bearer cron-test-secret"));
  expect((await result.json()).jobs.stock).toMatchObject({ failed: 1, pending: null, observation_failed: true });
  expect(jobs.refunds).toHaveBeenCalledOnce();
  expect(jobs.fees).toHaveBeenCalledOnce();
  expect(jobs.subscriptions).toHaveBeenCalledOnce();
});
