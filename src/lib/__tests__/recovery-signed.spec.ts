import { createHmac } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { signedRecoveryAuthorized } from "@/lib/recovery/signed-auth";

const seen = new Set<string>();
const insert = vi.fn(async ({ nonce }: { nonce: string }) => {
  if (seen.has(nonce)) return { error: { message: "duplicate" } };
  seen.add(nonce); return { error: null };
});
const db = { from: () => ({ insert, delete: () => ({ lt: async () => ({ error: null }) }) }) };
const nonce = "b6c0cc17-5a67-4f1b-90eb-a230e6e48c77";
const now = Math.floor(Date.now() / 1000);
function request(ts = now, signature = createHmac("sha256", "secret").update(`${ts}.${nonce}`).digest("hex")) {
  return new Request("https://tabletap.shop/api/cron/recover", { headers: {
    "X-Recover-Ts": String(ts), "X-Recover-Nonce": nonce, "X-Recover-Signature": signature,
  } });
}
beforeEach(() => { seen.clear(); insert.mockClear(); process.env.RECOVERY_SIGNING_SECRET = "secret"; });
it("accepts a fresh signature once and rejects replay, stale and invalid signatures", async () => {
  expect(await signedRecoveryAuthorized(request(), db as never)).toBe(true);
  expect(await signedRecoveryAuthorized(request(), db as never)).toBe(false);
  expect(await signedRecoveryAuthorized(request(now - 301), db as never)).toBe(false);
  expect(await signedRecoveryAuthorized(request(now + 305), db as never)).toBe(false);
  expect(await signedRecoveryAuthorized(request(now, "0".repeat(64)), db as never)).toBe(false);
  expect(insert).toHaveBeenCalledTimes(2);
});
