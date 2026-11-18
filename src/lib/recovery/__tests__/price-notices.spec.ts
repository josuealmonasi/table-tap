import { beforeEach, expect, it, vi } from "vitest";
import type { RecoveryContext } from "../job";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/mail", () => ({ sendMail: send }));

function fixture(count = 2) {
  const rows = Array.from({ length: count }, (_, i) => ({ change_id: "change", created_at: "2026-11-17T00:00:00Z", restaurant_id: `r${i}`, sent_at: null as string | null, attempts: 0, mail_body: null as { to: string; subject: string; text: string; html: string } | null, last_error: null as string | null,
    plan_price_changes: { created_at: "2026-11-17T00:00:00Z", new_monthly_price: 900, effective_at: "2027-01-01T06:00:00Z" },
    restaurants: { owner_id: `owner${i}`, stripe_subscription_id: `sub${i}` } }));
  const from = vi.fn(() => {
    let selected = rows.slice(), start = 0, end = rows.length, update: Record<string, unknown> | null = null;
    const q = {
      select: () => q, is: (key: string, value: unknown) => { selected = selected.filter(r => r[key as keyof typeof r] === value); return q; },
      eq: (key: string, value: unknown) => { selected = selected.filter(r => r[key as keyof typeof r] === value); return q; },
      order: () => q, range: (a: number, b: number) => { start = a; end = b + 1; return q; },
      update: (value: Record<string, unknown>) => { update = value; return q; }, returns: () => q,
      then: (resolve: (v: unknown) => void) => { if (update) selected.forEach(r => Object.assign(r, update));
        return Promise.resolve({ data: selected.slice(start, end), count: selected.length, error: null }).then(resolve); },
    }; return q;
  });
  const auth = { admin: { getUserById: vi.fn(async (id: string) => ({ data: { user: { email: `${id}@example.com` } }, error: null })) } };
  const client = { subscriptions: { retrieve: vi.fn(async () => ({ items: { data: [{ price: { unit_amount: 69900, currency: "mxn", recurring: { interval: "month", interval_count: 1 } } }] } })) } };
  return { rows, from, auth, client, context: { db: { from, auth }, client, deadline: Date.now() + 10000 } as unknown as RecoveryContext };
}
beforeEach(() => { send.mockReset(); send.mockResolvedValue({ sent: true }); });
it("sends a bounded batch to each queued owner with Spanish prices and a stable key", async () => {
  const { recoverPriceNotices } = await import("../price-notices");
  vi.spyOn(Math, "random").mockReturnValueOnce(0);
  const f = fixture(26); const result = await recoverPriceNotices(f.context);
  expect(result).toMatchObject({ done: 25, pending: 1, failed: 0 });
  expect(send).toHaveBeenCalledTimes(25);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "owner0@example.com", idempotencyKey: "price-notice/change/r0", text: expect.stringMatching(/699[\s\S]*900/) }));
  expect(f.rows.filter(r => r.sent_at)).toHaveLength(25);
});
it("retries a failure and never sends a delivered notice twice", async () => {
  const { recoverPriceNotices } = await import("../price-notices");
  const f = fixture(1); send.mockResolvedValueOnce({ sent: false, reason: "failed" });
  expect(await recoverPriceNotices(f.context)).toMatchObject({ done: 0, pending: 1, failed: 1 });
  expect(f.rows[0]).toMatchObject({ attempts: 1, last_error: "mail failed", sent_at: null });
  await recoverPriceNotices(f.context); await recoverPriceNotices(f.context);
  expect(send).toHaveBeenCalledTimes(2); expect(f.rows[0].sent_at).toBeTruthy();
});
it("does not invent a notice for a founder", async () => {
  const { recoverPriceNotices } = await import("../price-notices");
  const f = fixture(0); await recoverPriceNotices(f.context);
  expect(send).not.toHaveBeenCalled(); expect(f.from).toHaveBeenCalledTimes(2);
});

it("keeps the same address and body when a delivery reply is lost", async () => {
  const { recoverPriceNotices } = await import("../price-notices");
  const f = fixture(1); send.mockResolvedValueOnce({ sent: false, reason: "failed" });
  await recoverPriceNotices(f.context);
  f.auth.admin.getUserById.mockResolvedValueOnce({ data: { user: { email: "changed@example.com" } }, error: null });
  f.client.subscriptions.retrieve.mockResolvedValueOnce({ items: { data: [{ price: { unit_amount: 79900, currency: "mxn", recurring: { interval: "month", interval_count: 1 } } }] } });
  await recoverPriceNotices(f.context);
  const first = { ...send.mock.calls[0][0], signal: undefined };
  const second = { ...send.mock.calls[1][0], signal: undefined };
  expect(second).toEqual(first);
});

it("sends the new price to an owner without a subscription", async () => {
  const { recoverPriceNotices } = await import("../price-notices");
  const f = fixture(1); f.rows[0].restaurants.stripe_subscription_id = null as unknown as string;
  expect(await recoverPriceNotices(f.context)).toMatchObject({ done: 1, pending: 0, failed: 0 });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "owner0@example.com", text: expect.stringContaining("900.00") }));
  expect(f.client.subscriptions.retrieve).not.toHaveBeenCalled();
});

it("writes both languages and escapes the plan link in HTML", async () => {
  const { priceNoticeMail } = await import("../price-notice-mail");
  const input = { current: 699, next: 900, effectiveAt: "2027-01-01T06:00:00Z", link: "https://tabletap.shop/dashboard/plan?a=1&b=2" };
  const es = priceNoticeMail(input); const en = priceNoticeMail(input, "en");
  expect(es.text).toContain("primera factura"); expect(en.text).toContain("first bill");
  for (const mail of [es, en]) {
    expect(mail.text).toContain("699.00"); expect(mail.text).toContain("900.00");
    expect(mail.text).toContain(input.link); expect(mail.html).toContain("&amp;");
  }
});

it("bounds the provider call within the recovery deadline", async () => {
  const { recoverPriceNotices } = await import("../price-notices");
  const f = fixture(1); await recoverPriceNotices(f.context);
  expect(send.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
});
