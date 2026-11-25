import { afterEach, expect, it, vi } from "vitest";
import { sendMail } from "@/lib/mail";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("passes a statement operation's idempotency key to Resend", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RECEIPT_FROM_EMAIL", "test@example.com");
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  await sendMail({ to: "diner@example.com", subject: "Statement", html: "<p>Balance</p>", text: "Balance",
    idempotencyKey: "statement/account/operation-1" });
  expect(fetcher.mock.calls[0][1].headers["Idempotency-Key"]).toBe("statement/account/operation-1");
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).not.toHaveProperty("idempotencyKey");
});

it("preserves paragraph and item breaks in the provider's plain-text payload", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RECEIPT_FROM_EMAIL", "test@example.com");
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const text = "Statement\n\nTuesday\n1× Apple Pie\n1× Tea\n\nTotal: MX$250.00\n\nhttps://tabletap.test/cuenta/code";
  await sendMail({ to: "diner@example.com", subject: "Statement", html: "<p>Statement</p>", text });
  expect(JSON.parse(fetcher.mock.calls[0][1].body).text).toBe(text);
});

it("passes a caller's deadline signal to the provider", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RECEIPT_FROM_EMAIL", "test@example.com");
  const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await sendMail({ to: "owner@example.com", subject: "Plan", html: "Plan", text: "Plan", signal });
  expect(fetcher.mock.calls[0][1].signal).toBe(signal);
});

it("sends separate recipient bodies in a strict, idempotent batch and verifies all acknowledgments", async () => {
  vi.stubEnv("RESEND_API_KEY", "test-key"); vi.stubEnv("RECEIPT_FROM_EMAIL", "test@example.com");
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ data: [{ id: "one" }, { id: "two" }] }))
    .mockResolvedValueOnce(Response.json({ data: [{ id: "one" }] }));
  vi.stubGlobal("fetch", fetcher);
  const messages = ["owner@example.com", "manager@example.com"].map((to, i) => ({
    to, subject: "Digest", html: "<p>Sales</p>", text: "Sales", headers: { "List-Unsubscribe": `<https://test/${i}>` },
  }));
  const batch = { messages, idempotencyKey: "daily-digest/restaurant/2026-11-01/0", throwOnUncertainDelivery: true };
  await expect(sendMail(batch)).resolves.toEqual({ sent: true });
  const [url, options] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails/batch");
  expect(options.headers).toMatchObject({ "Idempotency-Key": batch.idempotencyKey, "X-Batch-Validation": "strict" });
  expect(JSON.parse(options.body).map((m: { to: string[]; headers: object }) => [m.to, m.headers]))
    .toEqual(messages.map(m => [[m.to], m.headers]));
  await expect(sendMail(batch)).rejects.toThrow("Mail batch delivery uncertain");
});
