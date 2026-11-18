import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ signed: false, bearer: false, github: false, fail: false, rows: [] as string[] }));
vi.mock("@/lib/cron-auth", () => ({ cronAuthorized: () => m.bearer }));
vi.mock("@/lib/github-cron-auth", () => ({ githubCronAuthorized: async () => m.github }));
vi.mock("@/lib/recovery/signed-auth", () => ({ signedRecoveryAuthorized: async () => m.signed }));
vi.mock("@/lib/ticket-email", () => ({ drainTicketEmailQueue: async () => ({ claimed: 0, sent: 0, retrying: 0, failed: 0, released: 0, errors: 0 }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const q = { select: () => q, eq: () => q, gte: async () => ({ count: 0, error: null }),
    insert: async () => { m.rows.push(table); return { error: null }; }, delete: () => q,
    lt: async () => ({ error: null }), order: () => q, limit: () => q,
    maybeSingle: async () => ({ data: m.rows.includes("recovery_runs") ? { at: new Date().toISOString() } : null, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/recovery/context", () => ({ recoveryContext: () => ({}) }));
vi.mock("@/lib/recovery/stock", () => ({ recoverStock: () => ({}) }));
vi.mock("@/lib/recovery/refunds", () => ({ recoverRefunds: () => ({}) }));
vi.mock("@/lib/recovery/fees", () => ({ recoverFees: () => ({}) }));
vi.mock("@/lib/recovery/subscriptions", () => ({ recoverSubscriptions: () => ({}) }));
vi.mock("@/lib/recovery/disputes", () => ({ recoverDisputes: () => ({}) }));
vi.mock("@/lib/recovery/job", () => ({ isolateJob: async () => ({ failed: m.fail ? 1 : 0, pending: 0 }) }));
import { GET } from "@/app/api/cron/recover/route";
const request = () => new Request("https://tabletap.shop/api/cron/recover", { headers: m.signed ? { "x-recover-signature": "test" } : {} });
beforeEach(() => { Object.assign(m, { signed: false, bearer: false, github: false, fail: false, rows: [] }); vi.stubEnv("VERCEL_ENV", "production"); });
it("only a successful signed database run refreshes scheduler health", async () => {
  m.bearer = true;
  expect((await (await GET(request())).json()).scheduler.ok).toBe(false);
  m.bearer = false; m.signed = true; m.fail = true;
  expect((await (await GET(request())).json()).scheduler.ok).toBe(false);
  m.fail = false;
  expect((await (await GET(request())).json()).scheduler.ok).toBe(true);
  expect(m.rows).toEqual(["recovery_runs"]);
});
it("retains bearer and GitHub authorization and refuses other callers", async () => {
  expect((await GET(request())).status).toBe(401);
  m.bearer = true; expect((await GET(request())).status).toBe(200);
  m.bearer = false; m.github = true; expect((await GET(request())).status).toBe(200);
});
