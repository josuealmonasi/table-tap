import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { jobs, context, drain, githubAuth } = vi.hoisted(() => ({ jobs: { stock: vi.fn(), refunds: vi.fn(), fees: vi.fn(), subscriptions: vi.fn(), disputes: vi.fn() }, context: vi.fn(), drain: vi.fn(), githubAuth: vi.fn() }));
vi.mock("@/lib/github-cron-auth", () => ({ githubCronAuthorized: githubAuth }));
vi.mock("@/lib/ticket-email", () => ({ drainTicketEmailQueue: drain }));
vi.mock("../context", () => ({ recoveryContext: context }));
vi.mock("../stock", () => ({ recoverStock: jobs.stock }));
vi.mock("../refunds", () => ({ recoverRefunds: jobs.refunds }));
vi.mock("../fees", () => ({ recoverFees: jobs.fees }));
vi.mock("../subscriptions", () => ({ recoverSubscriptions: jobs.subscriptions }));
vi.mock("../disputes", () => ({ recoverDisputes: jobs.disputes }));
const { GET } = await import("@/app/api/cron/recover/route");
const clean = { done: 0, pending: 0, failed: 0, oldest_pending_at: null, oldest_pending_age_seconds: null, age_basis: "created_at" };
const request = (authorization?: string) => new NextRequest("https://test/api/cron/recover", {
  headers: authorization === undefined ? {} : { authorization },
});
beforeEach(() => {
  vi.clearAllMocks();
  githubAuth.mockResolvedValue(false);
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  context.mockReturnValue({});
  Object.values(jobs).forEach(job => job.mockResolvedValue(clean));
  drain.mockResolvedValue(undefined);
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
  expect(await result.json()).toEqual({ jobs: { stock: clean, refunds: clean, fees: clean, subscriptions: clean, disputes: clean } });
  expect(context).toHaveBeenCalledTimes(5);
  expect(githubAuth).not.toHaveBeenCalled();
});
it("accepts the verified scheduler identity without a shared cron secret", async () => {
  vi.stubEnv("CRON_SECRET", undefined);
  githubAuth.mockResolvedValue(true);
  expect((await GET(request("Bearer fixture-identity"))).status).toBe(200);
  expect(githubAuth).toHaveBeenCalledOnce();
  expect(context).toHaveBeenCalledTimes(5);
});
it("a failed job cannot prevent the other jobs from running", async () => {
  jobs.stock.mockRejectedValue(new Error("database unavailable"));
  const result = await GET(request("Bearer cron-test-secret"));
  expect((await result.json()).jobs.stock).toMatchObject({ failed: 1, pending: null, observation_failed: true });
  expect(jobs.refunds).toHaveBeenCalledOnce();
  expect(jobs.fees).toHaveBeenCalledOnce();
  expect(jobs.subscriptions).toHaveBeenCalledOnce();
});
it("finding 5: drains ticket emails alongside the jobs, with its own deadline, before answering", async () => {
  let finished = false;
  drain.mockImplementation(() => new Promise<void>(done => setTimeout(() => { finished = true; done(); }, 20)));
  const started = Date.now();
  expect((await GET(request("Bearer cron-test-secret"))).status).toBe(200);
  expect(finished).toBe(true);
  const [, , deadline] = drain.mock.calls[0];
  expect(deadline - started).toBeGreaterThanOrEqual(30_000);
  expect(deadline - started).toBeLessThanOrEqual(45_000);
  expect(drain.mock.invocationCallOrder[0]).toBeLessThan(jobs.stock.mock.invocationCallOrder[0]);
});
