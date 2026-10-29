import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Every bucket the route asks about, and how many hits each has had.
const hits = new Map<string, number>();
const sendMail = vi.fn();
vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => `ip-${hits.size}`,
  isRateLimited: async (bucket: string, limit: number) => {
    const n = (hits.get(bucket) ?? 0) + 1;
    hits.set(bucket, n);
    return n > limit;
  },
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ error: key }, { status }) }));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => true, sendMail: (...args: unknown[]) => sendMail(...args) }));
vi.mock("@/lib/accounts-server", () => ({
  accountByCode: async () => ({ id: "acct-1", restaurant_id: "r1", name: "Carmen", code: "ZMYKTJ6GDA2Y" }),
  statementOf: async () => ({ lines: [], owed: 600 }),
}));
vi.mock("@/lib/account-mail", () => ({ statementMail: () => ({ subject: "s", text: "t", html: "h" }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { name: "Demo", currency: "MXN", timezone: null } }) }) }) }) }),
}));
import { POST } from "@/app/api/account/email/route";

const send = (ref = "statement-operation-1") => POST(new NextRequest("http://localhost/api/account/email", {
  method: "POST", body: JSON.stringify({ c: "ZMYKTJ6GDA2Y", email: "someone@example.com", ref }),
}));

beforeEach(() => { hits.clear(); sendMail.mockReset(); sendMail.mockResolvedValue({ sent: true }); });

// The address limit alone let one code mail the statement ~400 times a day:
// each request here comes from a new address, so only the account's own
// allowance can stop the fifth.
it("sends an account's statement at most four times a day, from any number of addresses", async () => {
  const answers = [];
  for (let n = 0; n < 6; n++) answers.push((await send()).status);
  expect(answers).toEqual([200, 200, 200, 200, 429, 429]);
  expect(sendMail).toHaveBeenCalledTimes(4);
});

it("keeps nothing about the recipient in any limit", async () => {
  await send();
  expect([...hits.keys()].some(bucket => bucket.includes("someone") || bucket.includes("example.com"))).toBe(false);
});


it("retries one statement with the same provider key and changes it for an intentional resend", async () => {
  await send(); await send(); await send("statement-operation-2");
  const keys = sendMail.mock.calls.map(([mail]) => mail.idempotencyKey);
  expect(keys[0]).toBe("statement/acct-1/statement-operation-1");
  expect(keys[1]).toBe(keys[0]); expect(keys[2]).not.toBe(keys[0]);
});


it("requires an operation reference before sending", async () => {
  expect((await send("")).status).toBe(400);
  expect(sendMail).not.toHaveBeenCalled();
});
