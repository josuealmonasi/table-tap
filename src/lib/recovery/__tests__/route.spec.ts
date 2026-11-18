import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { jobs, context, drain, githubAuth, expired } = vi.hoisted(() => ({ jobs: { stock: vi.fn(), refunds: vi.fn(), fees: vi.fn(), subscriptions: vi.fn(), disputes: vi.fn(), accounting: vi.fn(), price_notices: vi.fn() }, context: vi.fn(), drain: vi.fn(), githubAuth: vi.fn(), expired: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ gte: expired }) }) }) }) }));
vi.mock("@/lib/github-cron-auth", () => ({ githubCronAuthorized: githubAuth }));
vi.mock("@/lib/ticket-email", () => ({ drainTicketEmailQueue: drain }));
vi.mock("../context", () => ({ recoveryContext: context }));
vi.mock("../stock", () => ({ recoverStock: jobs.stock }));
vi.mock("../refunds", () => ({ recoverRefunds: jobs.refunds }));
vi.mock("../fees", () => ({ recoverFees: jobs.fees }));
vi.mock("../subscriptions", () => ({ recoverSubscriptions: jobs.subscriptions }));
vi.mock("../disputes", () => ({ recoverDisputes: jobs.disputes }));
vi.mock("../price-notices", () => ({ recoverPriceNotices: jobs.price_notices }));
vi.mock("../accounting-purge", () => ({ purgeAccounting: jobs.accounting }));
const { GET, POST } = await import("@/app/api/cron/recover/route");
const clean = { done: 0, pending: 0, failed: 0, oldest_pending_at: null, oldest_pending_age_seconds: null, age_basis: "created_at" };
const drained = { claimed: 3, sent: 2, retrying: 1, failed: 0, released: 0, errors: 0 };
const request = (authorization?: string) => new NextRequest("https://test/api/cron/recover", {
  headers: authorization === undefined ? {} : { authorization },
});
beforeEach(() => {
  vi.clearAllMocks();
  githubAuth.mockResolvedValue(false);
  vi.stubEnv("CRON_SECRET", "cron-test-secret");
  context.mockReturnValue({});
  Object.values(jobs).forEach(job => job.mockResolvedValue(clean));
  drain.mockResolvedValue(drained);
  expired.mockResolvedValue({ count: 0, error: null });
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
  expect(await result.json()).toEqual({ jobs: { stock: clean, refunds: clean, fees: clean, subscriptions: clean, disputes: clean, accounting: clean, price_notices: clean }, tickets: { ...drained, expired: 0 },
    scheduler: { ok: true, status: "skipped: no scheduler on dev" } });
  expect(context).toHaveBeenCalledTimes(7);
  expect(githubAuth).not.toHaveBeenCalled();
});
it("accepts the verified scheduler identity without a shared cron secret", async () => {
  vi.stubEnv("CRON_SECRET", undefined);
  githubAuth.mockResolvedValue(true);
  expect((await GET(request("Bearer fixture-identity"))).status).toBe(200);
  expect(githubAuth).toHaveBeenCalledOnce();
  expect(context).toHaveBeenCalledTimes(7);
});
it("audit #648: the database's five-minute job POSTs with the same bearer, and nothing else gets in", async () => {
  const post = (authorization?: string) => new NextRequest("https://test/api/cron/recover", { method: "POST", headers: authorization ? { authorization } : {} });
  expect((await POST(post("Bearer cron-test-secret"))).status).toBe(200);
  expect(context).toHaveBeenCalledTimes(7);
  vi.clearAllMocks(); githubAuth.mockResolvedValue(false);
  for (const authorization of [undefined, "Bearer wrong", "Bearer cron-test-secreT"]) expect((await POST(post(authorization))).status).toBe(401);
  expect(context).not.toHaveBeenCalled();
});
it("audit #648: reports the ticket drain, with tickets the claim expired during this run", async () => {
  expired.mockResolvedValue({ count: 2, error: null });
  expect((await (await GET(request("Bearer cron-test-secret"))).json()).tickets).toEqual({ ...drained, expired: 2 });
  expect(expired.mock.calls[0][0]).toBe("finished_at");
  expired.mockResolvedValue({ count: null, error: { message: "down" } });
  expect((await (await GET(request("Bearer cron-test-secret"))).json()).tickets).toMatchObject({ errors: 1 });
  drain.mockRejectedValue(new Error("boom"));
  expect((await (await GET(request("Bearer cron-test-secret"))).json()).tickets).toBeNull();
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
  drain.mockImplementation(() => new Promise(done => setTimeout(() => { finished = true; done(drained); }, 20)));
  const started = Date.now();
  expect((await GET(request("Bearer cron-test-secret"))).status).toBe(200);
  expect(finished).toBe(true);
  const [, , deadline] = drain.mock.calls[0];
  expect(deadline - started).toBeGreaterThanOrEqual(30_000);
  expect(deadline - started).toBeLessThanOrEqual(45_000);
  expect(drain.mock.invocationCallOrder[0]).toBeLessThan(jobs.stock.mock.invocationCallOrder[0]);
});
