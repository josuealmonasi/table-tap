import { beforeEach, expect, it, vi } from "vitest";

const sent: { to: string; subject: string; idempotencyKey?: string }[] = [];
let marked: Record<string, unknown>[] = [];
let mailOk = true;
vi.mock("@/lib/mail", () => ({ sendMail: async (m: { to: string; subject: string; idempotencyKey?: string }) => (sent.push(m), { sent: mailOk }) }));

import { recoverTrialReminders } from "@/lib/recovery/trial-reminders";
import { trialReminderMail } from "@/lib/recovery/trial-reminder-mail";

const due = { restaurant_id: "r1", owner_id: "u1", trial_ends_at: "2026-11-21T17:57:18Z", created_at: "2026-11-18T17:57:18Z" };
function db(locale?: string) {
  return {
    from(table: string) {
      const q: Record<string, unknown> = {};
      const self = () => q;
      Object.assign(q, { select: self, order: self, eq: self, is: self, returns: self,
        range: () => ({ returns: async () => ({ data: table === "trial_reminders_due" ? [due] : [], count: 1, error: null }) }),
        maybeSingle: async () => ({ data: { plan: "servicio" }, error: null }),
        update: (patch: Record<string, unknown>) => { marked.push(patch); return { eq: () => ({ eq: async () => ({ error: null }) }) }; } });
      return q;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@x.dev", user_metadata: locale ? { locale } : {} } }, error: null }) } },
  };
}
const context = (d: unknown) => ({ db: d, client: {}, deadline: Date.now() + 10_000 }) as never;
beforeEach(() => { sent.length = 0; marked = []; mailOk = true; });

it("emails the owner once per trial end, in their language, and records that end date", async () => {
  const result = await recoverTrialReminders(context(db("en")));
  expect(result.done).toBe(1);
  expect(sent).toHaveLength(1);
  expect(sent[0].to).toBe("owner@x.dev");
  expect(sent[0].subject).toContain("Your free Servicio trial ends on");
  expect(sent[0].idempotencyKey).toBe("trial-reminder/r1/2026-11-21T17:57:18Z");
  expect(marked).toEqual([{ trial_reminded_for: "2026-11-21T17:57:18Z" }]);
});

it("is Spanish without a saved language, and records nothing when the mail fails", async () => {
  mailOk = false;
  const result = await recoverTrialReminders(context(db()));
  expect(result.failed).toBe(1);
  expect(sent[0].subject).toContain("Tu prueba gratis de Servicio termina el");
  expect(marked).toEqual([]);
});

it("says when, what happens after (Carta, nothing lost) and links to Plan", () => {
  const m = trialReminderMail({ plan: "servicio", endsAt: "2026-11-21T17:57:18Z", link: "https://tabletap.shop/dashboard/plan" });
  expect(m.text).toContain("21 de noviembre de 2026");
  expect(m.text).toContain("Carta");
  expect(m.html).toContain('href="https://tabletap.shop/dashboard/plan"');
});
