import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readDigestStopToken } from "@/lib/digest-stop-token";
import { sendMail, type MailBatch } from "@/lib/mail";
import { recoverDailyDigests } from "../daily-digest";
import { readDigestFigures, type DigestFigures } from "../digest-figures";
import type { RecoveryContext } from "../job";

vi.mock("@/lib/mail", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/mail")>(), sendMail: vi.fn() }));
vi.mock("../digest-figures", () => ({ readDigestFigures: vi.fn() }));

const day = "2026-11-01";
const owner = "11111111-1111-4111-8111-111111111111";
const manager = "22222222-2222-4222-8222-222222222222";
const restaurant = { restaurant_id: "r", owner_id: owner, name: "Bistro", currency: "MXN",
  timezone: "America/Mexico_City", digest_day: day, created_at: "2026-11-02T13:00:00Z" };
const users = [
  { user_id: owner, email: "owner@example.test", is_owner: true, locale: "es" },
  { user_id: manager, email: "manager@example.test", is_owner: false, locale: "en" },
];
const figures: DigestFigures = {
  day: new Date("2026-11-01T06:00:00Z"), sales: 100, salesChange: null, avgTicket: 100, count: 1, card: 10, cash: 90,
  dineIn: 0, toGo: 1, tips: 0, discounts: 0, refunds: { count: 0, amount: 0 }, dishes: [],
  attention: { discounts: 0, writeOffs: 0, offline: 0, due: 0, accounts: { count: 0, balances: [] }, stockouts: [] },
};

function fixture(people = users, outside: { email: string; stop_token: string; status: string }[] = []) {
  let claimed: string | null = null;
  const events: string[] = [];
  const getUserById = vi.fn(async () => ({ data: { user: { user_metadata: { locale: "en" } } }, error: null }));
  const db = { auth: { admin: { getUserById } }, from(table: string) {
    if (table === "daily_digests_due") {
      const data = claimed === null ? [restaurant] : [];
      const q = { select: () => q, order: () => q, range: () => q,
        returns: async () => ({ data, count: data.length, error: null }) };
      return q;
    }
    if (table === "daily_digest_recipients") {
      const q = { select: () => q, eq: (key: string, id: string) => {
        expect([key, id]).toEqual(["restaurant_id", restaurant.restaurant_id]); return q;
      }, order: () => q, range: async (from: number) => ({ data: people.slice(from), error: null }) };
      return q;
    }
    if (table === "digest_recipients") {
      return { select: () => ({ eq: (key: string, id: string) => {
        expect([key, id]).toEqual(["restaurant_id", restaurant.restaurant_id]);
        return { eq: async (column: string, status: string) => {
          expect(column).toBe("status");
          return { data: outside.filter(row => row.status === status), error: null };
        } };
      } }) };
    }
    if (table !== "restaurants") throw new Error(`Unexpected table ${table}`);
    return { update: (patch: { digest_sent_for: string | null }) => {
      const q = {
        eq: (column: string, value: string) => {
          if (column === "digest_sent_for") {
            expect(claimed).toBe(value);
            claimed = null;
            events.push("release");
            return Promise.resolve({ error: null });
          }
          return q;
        },
        or: (guard: string) => { expect(guard).toBe(`digest_sent_for.is.null,digest_sent_for.lt.${day}`); return q; },
        select: async () => {
          if (claimed !== null && claimed >= day) return { data: [], error: null };
          claimed = patch.digest_sent_for;
          events.push("claim");
          return { data: [{ id: "r" }], error: null };
        },
      };
      return q;
    } };
  } };
  return { context: { db, deadline: Date.now() + 10_000 } as unknown as RecoveryContext, events, claim: () => claimed, getUserById };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "digest-fixture-secret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example");
  vi.mocked(sendMail).mockReset().mockResolvedValue({ sent: true });
  vi.mocked(readDigestFigures).mockReset().mockResolvedValue(figures);
});
afterEach(() => vi.unstubAllEnvs());

it("claims once before sending personalized mail during two overlapping recoveries", async () => {
  const { context, events, claim } = fixture();
  vi.mocked(sendMail).mockImplementation(async () => { events.push("send"); return { sent: true }; });
  const results = await Promise.all([recoverDailyDigests(context), recoverDailyDigests(context)]);
  expect(results.map(r => r.done).sort()).toEqual([0, 1]);
  expect(events).toEqual(["claim", "send"]);
  expect(claim()).toBe(day);
  expect(sendMail).toHaveBeenCalledOnce();
  const [{ messages, idempotencyKey, throwOnUncertainDelivery }] = vi.mocked(sendMail).mock.calls[0] as [MailBatch];
  expect(idempotencyKey).toBe(`daily-digest/r/${day}/0`);
  expect(throwOnUncertainDelivery).toBe(true);
  expect(messages.map(m => [m.to, m.subject])).toEqual([
    ["owner@example.test", "Así te fue ayer · Bistro"], ["manager@example.test", "How yesterday went · Bistro"],
  ]);
  for (const [i, message] of messages.entries()) {
    const url = new URL(message.headers!["List-Unsubscribe"].slice(1, -1));
    expect(url.pathname).toBe("/api/digest/opt-out");
    expect(readDigestStopToken(url.searchParams.get("t"))).toEqual({ userId: users[i].user_id, locale: users[i].locale });
  }
  expect((await recoverDailyDigests(context)).done).toBe(0);
});

it("skips a zero-sales day before claiming or sending", async () => {
  const f = fixture();
  vi.mocked(readDigestFigures).mockResolvedValue(null);
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 0 });
  expect(f.events).toEqual([]);
  expect(sendMail).not.toHaveBeenCalled();
});

it("skips when a recipient opts out after discovery", async () => {
  const f = fixture([]);
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 0 });
  expect(f.events).toEqual([]);
  expect(sendMail).not.toHaveBeenCalled();
});

it("sends only to confirmed outside addresses and uses the opted-out owner's language", async () => {
  const token = "c".repeat(43);
  const f = fixture([], [
    { email: "outside@example.test", stop_token: token, status: "confirmed" },
    { email: "pending@example.test", stop_token: "p".repeat(43), status: "pending" },
  ]);
  expect((await recoverDailyDigests(f.context)).done).toBe(1);
  expect(f.getUserById).toHaveBeenCalledExactlyOnceWith(owner);
  const [{ messages }] = vi.mocked(sendMail).mock.calls[0] as [MailBatch];
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatchObject({
    to: "outside@example.test", subject: "How yesterday went · Bistro",
    text: expect.stringContaining(`https://test.example/digest/stop?t=${token}`),
    headers: { "List-Unsubscribe": `<https://test.example/api/digest/stop?t=${token}>` },
  });
  expect(f.events).toEqual(["claim"]);
});

it("releases a confirmed refusal and retries the same day with the same key", async () => {
  const f = fixture([users[0]]);
  vi.mocked(sendMail).mockResolvedValueOnce({ sent: false, reason: "failed", status: 429 });
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 1, pending: 1 });
  expect(f.events).toEqual(["claim", "release"]);
  expect(f.claim()).toBeNull();
  expect((await recoverDailyDigests(f.context)).done).toBe(1);
  const keys = vi.mocked(sendMail).mock.calls.map(([m]) => m.idempotencyKey);
  expect(new Set(keys).size).toBe(1);
});

it("keeps the claim when the provider may have accepted the batch", async () => {
  const f = fixture();
  vi.mocked(sendMail).mockRejectedValueOnce(new Error("Reply was lost"));
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 1, pending: 0 });
  expect(f.events).toEqual(["claim"]);
  expect(f.claim()).toBe(day);
  await recoverDailyDigests(f.context);
  expect(sendMail).toHaveBeenCalledOnce();
});
