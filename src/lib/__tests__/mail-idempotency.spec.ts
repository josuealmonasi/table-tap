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
