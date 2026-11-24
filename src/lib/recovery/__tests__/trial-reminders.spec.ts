import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sendMail } from "@/lib/mail";
import { recoverTrialReminders } from "@/lib/recovery/trial-reminders";
import { trialReminderMail } from "@/lib/recovery/trial-reminder-mail";

vi.mock("@/lib/mail", () => ({ sendMail: vi.fn() }));
const send = vi.mocked(sendMail);

const due = { restaurant_id: "r1", owner_id: "u1", trial_ends_at: "2026-11-21T17:57:18Z", created_at: "2026-11-18T17:57:18Z" };
const eligible = {
  id: due.restaurant_id,
  plan: "servicio",
  trial_ends_at: due.trial_ends_at,
  plan_status: "trialing",
  stripe_subscription_id: null as string | null,
  tier_assignment_id: null as string | null,
  trial_reminded_for: null as string | null,
};
type Restaurant = typeof eligible;

function db(locale?: string) {
  const restaurant = { ...eligible };
  const markError = { message: "reminder write failed" };
  const mock = {
    restaurant,
    failMarkAfterSend: false,
    from(table: string) {
      if (table === "trial_reminders_due") {
        const view = {
          select: () => view,
          order: () => view,
          // The worker may already have read this row before another writer changed it.
          range: () => ({ returns: async () => ({ data: [due], count: 1, error: null }) }),
        };
        return view;
      }
      let patch: Partial<Restaurant> | undefined;
      let matches = true;
      const query = {
        eq: (key: keyof Restaurant, value: string) => { matches &&= restaurant[key] === value; return query; },
        is: (key: keyof Restaurant, value: null) => { matches &&= restaurant[key] === value; return query; },
        or: (filters: string) => {
          expect(filters).toBe(`trial_reminded_for.is.null,trial_reminded_for.neq."${due.trial_ends_at}"`);
          matches &&= restaurant.trial_reminded_for !== due.trial_ends_at;
          return query;
        },
        update: (values: Partial<Restaurant>) => { patch = values; return query; },
        select: (columns: string) => {
          expect(columns).toBe("plan");
          return query;
        },
        maybeSingle: async () => {
          const { data, error } = await query;
          return { data: data?.[0] ?? null, error };
        },
        then(resolve: (value: { data: { plan: string }[] | null; error: typeof markError | null }) => void) {
          if (patch && matches) {
            if (mock.failMarkAfterSend && restaurant.trial_reminded_for === null && send.mock.calls.length) {
              resolve({ data: null, error: markError });
              return;
            }
            Object.assign(restaurant, patch);
          }
          resolve({ data: matches ? [{ plan: restaurant.plan }] : [], error: null });
        },
      };
      return query;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@x.dev", user_metadata: locale ? { locale } : {} } }, error: null }) } },
  };
  return mock;
}

const context = (d: unknown) => ({ db: d, client: {}, deadline: Date.now() + 10_000 }) as never;
beforeEach(() => { send.mockReset().mockResolvedValue({ sent: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("emails the owner once per trial end, in their language, and records that end date", async () => {
  const d = db("en");
  const result = await recoverTrialReminders(context(d));
  expect(result.done).toBe(1);
  expect(send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    to: "owner@x.dev",
    subject: expect.stringContaining("Your free Servicio trial ends on"),
    idempotencyKey: "trial-reminder/r1/2026-11-21T17:57:18Z",
  }));
  expect(d.restaurant.trial_reminded_for).toBe(due.trial_ends_at);
});

it.each([
  ["the status changed", { plan_status: "active" }],
  ["the owner subscribed", { stripe_subscription_id: "sub_1" }],
  ["an admin assigned a tier", { tier_assignment_id: "assignment_1" }],
  ["the trial was extended", { trial_ends_at: "2026-11-28T17:57:18Z" }],
] satisfies [string, Partial<Restaurant>][])("skips a stale due row when %s", async (_reason, change) => {
  const d = db();
  Object.assign(d.restaurant, change);
  const result = await recoverTrialReminders(context(d));
  expect(result).toMatchObject({ done: 0, failed: 0 });
  expect(send).not.toHaveBeenCalled();
  expect(d.restaurant.trial_reminded_for).toBeNull();
});

it("does not send twice when a write after sending would fail", async () => {
  const d = db();
  d.failMarkAfterSend = true;
  const first = await recoverTrialReminders(context(d));
  const retry = await recoverTrialReminders(context(d));
  expect(send).toHaveBeenCalledTimes(1);
  expect(first).toMatchObject({ done: 1, failed: 0 });
  expect(retry).toMatchObject({ done: 0, failed: 0 });
  expect(d.restaurant.trial_reminded_for).toBe(due.trial_ends_at);
});

it("uses Spanish by default and releases the claim after a definite refusal", async () => {
  const d = db();
  let claimAtSend: string | null = null;
  send.mockImplementationOnce(async () => {
    claimAtSend = d.restaurant.trial_reminded_for;
    return { sent: false, reason: "failed", status: 400 };
  });
  const result = await recoverTrialReminders(context(d));
  expect(result.failed).toBe(1);
  expect(claimAtSend).toBe(due.trial_ends_at);
  expect(send.mock.calls[0][0].subject).toContain("Tu prueba gratis de Servicio termina el");
  expect(d.restaurant.trial_reminded_for).toBeNull();
  expect((await recoverTrialReminders(context(d))).done).toBe(1);
});

it("keeps the claim when sending throws", async () => {
  const d = db();
  send.mockRejectedValueOnce(new Error("mail timed out"));
  expect((await recoverTrialReminders(context(d))).failed).toBe(1);
  expect(d.restaurant.trial_reminded_for).toBe(due.trial_ends_at);
  await recoverTrialReminders(context(d));
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(["connection drops", "returns HTTP 500", "returns HTTP 409"])("keeps the claim when Resend %s", async outcome => {
  const d = db();
  const mail = await vi.importActual<typeof import("@/lib/mail")>("@/lib/mail");
  send.mockImplementation(mail.sendMail);
  vi.stubEnv("RESEND_API_KEY", "test-key");
  vi.stubEnv("RECEIPT_FROM_EMAIL", "test@example.com");
  const fetcher = vi.fn();
  if (outcome === "connection drops") fetcher.mockRejectedValue(new Error("connection dropped"));
  else fetcher.mockResolvedValue(new Response("{}", { status: outcome.endsWith("500") ? 500 : 409 }));
  vi.stubGlobal("fetch", fetcher);
  expect((await recoverTrialReminders(context(d))).failed).toBe(1);
  expect(d.restaurant.trial_reminded_for).toBe(due.trial_ends_at);
  await recoverTrialReminders(context(d));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("says when, what happens after (Carta, nothing lost) and links to Plan", () => {
  const m = trialReminderMail({ plan: "servicio", endsAt: "2026-11-21T17:57:18Z", link: "https://tabletap.shop/dashboard/plan" });
  expect(m.text).toContain("21 de noviembre de 2026");
  expect(m.text).toContain("Carta");
  expect(m.html).toContain('href="https://tabletap.shop/dashboard/plan"');
});
