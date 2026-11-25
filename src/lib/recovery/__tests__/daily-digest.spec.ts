import { createHash } from "node:crypto";
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
const restaurant = { restaurant_id: "33333333-3333-4333-8333-333333333333", owner_id: owner, name: "Bistro", currency: "MXN",
  timezone: "America/Mexico_City", digest_day: day, created_at: "2026-11-02T13:00:00Z" };

function mailbox(email: string, userId: string | null, isOwner = false, locale = "en") {
  return {
    address_key: createHash("sha256").update(email.trim().toLowerCase()).digest("hex"),
    email, user_id: userId, is_owner: isOwner, locale,
    preference_version: userId ? "0" : null, stop_token: userId ? null : "c".repeat(43),
  };
}
const users = [mailbox("owner@example.test", owner, true, "es"), mailbox("manager@example.test", manager)];
const figures: DigestFigures = {
  day: new Date("2026-11-01T06:00:00Z"), sales: 100, salesChange: null, avgTicket: 100, count: 1, card: 10, cash: 90,
  dineIn: 0, toGo: 1, tips: 0, discounts: 0, refunds: { count: 0, amount: 0 }, dishes: [],
  attention: { discounts: 0, writeOffs: 0, offline: 0, due: 0, accounts: { count: 0, balances: [] }, stockouts: [] },
};

function fixture(people = [...users]) {
  const events: string[] = [];
  const batches: { id: string; status: string; address_keys: string[] }[] = [];
  let claimed = false;
  let discoverNew = true;
  const db = {
    rpc: vi.fn(async (name: string, args: { p_day: string; p_batch_size: number }) => {
      expect(name).toBe("claim_daily_digest_v2");
      expect(args.p_day).toBe(day);
      if (!claimed) {
        claimed = true;
        events.push("claim");
        const keys = people.map(p => p.address_key);
        for (let i = 0; i < keys.length; i += args.p_batch_size) {
          batches.push({ id: String(i), status: "pending", address_keys: keys.slice(i, i + args.p_batch_size) });
        }
      }
      return { error: null };
    }),
    from(table: string) {
      if (table === "daily_digests_due_v2") {
        const pending = batches.some(b => b.status === "pending");
        const due = pending || (!claimed && discoverNew);
        const q = { select: () => q, order: () => q, range: () => q,
          returns: async () => ({ data: due ? [{ ...restaurant, retry: pending }] : [], count: Number(due), error: null }) };
        return q;
      }
      if (table === "daily_digest_mailboxes") {
        let keys: string[];
        const q = {
          select: () => q, order: () => q,
          eq: (column: string, value: string) => {
            expect([column, value]).toEqual(["restaurant_id", restaurant.restaurant_id]);
            return q;
          },
          in: (column: string, values: string[]) => { expect(column).toBe("address_key"); keys = values; return q; },
          returns: async () => {
            events.push("recheck");
            return { data: people.filter(p => keys.includes(p.address_key)), error: null };
          },
        };
        return q;
      }
      if (table !== "daily_digest_batches") throw new Error(`Unexpected table ${table}`);
      const query = (patch?: { status: string; address_keys?: string[] }) => {
        let id: string | undefined;
        let status: string | undefined;
        const apply = async () => {
          const row = batches.find(b => b.id === id && b.status === status);
          if (row && patch) {
            Object.assign(row, patch);
            events.push(patch.status);
          }
          return { data: row ? [{ id }] : [], error: null };
        };
        const q = {
          eq: (key: string, value: string) => {
            if (key === "id") id = value;
            if (key === "status") status = value;
            return q;
          },
          select: () => patch ? apply() : q, order: () => q,
          range: async (from: number, to: number) => ({
            data: batches.filter(b => b.status === status).slice(from, to + 1).map(b => ({ ...b })), error: null,
          }),
          then: (resolve: (value: unknown) => void) => apply().then(resolve),
        };
        return q;
      };
      return { ...query(), update: query };
    },
  };
  return { context: { db, deadline: Date.now() + 10_000 } as unknown as RecoveryContext, batches, events,
    advanceDay: () => { discoverNew = false; } };
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_SECRET_KEY", "digest-fixture-secret");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://test.example");
  vi.mocked(sendMail).mockReset().mockResolvedValue({ sent: true });
  vi.mocked(readDigestFigures).mockReset().mockResolvedValue(figures);
});
afterEach(() => vi.unstubAllEnvs());

function sentBatch(index = 0): MailBatch {
  return vi.mocked(sendMail).mock.calls[index][0] as MailBatch;
}

it("claims a batch only once in overlapping runs and sends personalized mail with scoped links", async () => {
  const { context, events } = fixture();
  vi.mocked(sendMail).mockImplementation(async () => { events.push("send"); return { sent: true }; });
  const results = await Promise.all([recoverDailyDigests(context), recoverDailyDigests(context)]);
  expect(results.map(r => r.done).sort()).toEqual([0, 1]);
  expect(events).toEqual(["claim", "submitting", "recheck", "send", "accepted"]);
  const { messages, throwOnUncertainDelivery } = sentBatch();
  expect(throwOnUncertainDelivery).toBe(true);
  expect(messages.map(m => [m.to, m.subject])).toEqual([
    ["owner@example.test", "Así te fue ayer · Bistro"], ["manager@example.test", "How yesterday went · Bistro"],
  ]);
  for (const [i, message] of messages.entries()) {
    const url = new URL(message.headers!["List-Unsubscribe"].slice(1, -1));
    expect(url.pathname).toBe("/api/digest/opt-out");
    expect(readDigestStopToken(url.searchParams.get("t"))).toEqual({
      restaurantId: restaurant.restaurant_id, userId: users[i].user_id, locale: users[i].locale,
      version: "0", addressKey: users[i].address_key,
    });
  }
  expect((await recoverDailyDigests(context)).done).toBe(0);
  expect(sendMail).toHaveBeenCalledOnce();
});

it("skips a zero-sales day before claiming or sending", async () => {
  const f = fixture();
  vi.mocked(readDigestFigures).mockResolvedValue(null);
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 0 });
  expect(f.events).toEqual([]);
  expect(sendMail).not.toHaveBeenCalled();
});

it("rechecks each batch after its claim and drops removed recipients before the next provider call", async () => {
  const extra = Array.from({ length: 99 }, (_, i) => mailbox(`staff${i}@example.test`, manager));
  const people = [users[0], ...extra, users[1], mailbox("outside@example.test", null)];
  const f = fixture(people);
  vi.mocked(sendMail).mockImplementationOnce(async () => {
    people.splice(100, 2); // A manager loses eligibility and an outside address stops.
    return { sent: true };
  });
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 1, pending: 0 });
  expect(f.events).toEqual(["claim", "submitting", "recheck", "accepted", "submitting", "recheck", "skipped"]);
  expect(sentBatch().messages).toHaveLength(100);
  expect(sendMail).toHaveBeenCalledOnce();
});

it("uses the current outside stop link and locale", async () => {
  const f = fixture([mailbox("outside@example.test", null)]);
  expect((await recoverDailyDigests(f.context)).done).toBe(1);
  expect(sentBatch().messages).toMatchObject([{
    to: "outside@example.test", subject: "How yesterday went · Bistro",
    headers: { "List-Unsubscribe": `<https://test.example/api/digest/stop?t=${"c".repeat(43)}>` },
  }]);
});

it("retries only a refused batch after the report day advances", async () => {
  const people = Array.from({ length: 101 }, (_, i) => mailbox(`staff${i}@example.test`, manager));
  const f = fixture(people);
  vi.mocked(sendMail).mockResolvedValueOnce({ sent: true })
    .mockResolvedValueOnce({ sent: false, reason: "failed", status: 429 });
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 1, pending: 1 });
  expect(f.batches.map(b => b.status)).toEqual(["accepted", "pending"]);
  f.advanceDay();
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 1, failed: 0, pending: 0 });
  expect(vi.mocked(sendMail).mock.calls.map((_, index) => sentBatch(index).messages.length)).toEqual([100, 1, 1]);
  expect(sentBatch(2).messages[0].to).toBe("staff100@example.test");
  expect(sentBatch(1).idempotencyKey).toEqual(sentBatch(2).idempotencyKey);
  expect(readDigestFigures).toHaveBeenLastCalledWith(f.context.db, expect.objectContaining({ digest_day: day }),
    new Date(restaurant.created_at));
});

it("keeps a fully refused day discoverable after the local calendar moves on", async () => {
  const f = fixture();
  vi.mocked(sendMail).mockResolvedValueOnce({ sent: false, reason: "failed", status: 429 });
  expect((await recoverDailyDigests(f.context)).pending).toBe(1);
  f.advanceDay();
  expect((await recoverDailyDigests(f.context)).done).toBe(1);
  expect(sendMail).toHaveBeenCalledTimes(2);
});

it("records an uncertain submission without replaying the affected batch", async () => {
  const f = fixture();
  vi.mocked(sendMail).mockRejectedValueOnce(new Error("Reply was lost"));
  expect(await recoverDailyDigests(f.context)).toMatchObject({ done: 0, failed: 1, pending: 0 });
  expect(f.batches[0]).toMatchObject({ status: "uncertain", address_keys: [] });
  await recoverDailyDigests(f.context);
  expect(sendMail).toHaveBeenCalledOnce();
});
