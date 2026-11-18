import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ cards: [] as Record<string, string | null>[] }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRoomLimited: async () => false, isRateLimited: async () => false }));
vi.mock("@/lib/loyalty/server", () => ({ CARD_COLUMNS: "id,code", cardState: async () => ({ ladder: [] }) }));
vi.mock("@/lib/loyalty/face", () => ({ cardFace: () => ({ qrPayload: "url", standing: {} }) }));
vi.mock("@/lib/loyalty/qr-grid", () => ({ qrGrid: () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const filters: Record<string, string> = {};
  let patch: Record<string, string | null> | undefined;
  const answer = () => {
    const rows = state.cards.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    const row = rows[0];
    if (table === "loyalty_cards" && patch && row) {
      const schema = readFileSync("supabase/schema.sql", "utf8");
      if (patch.email && /create unique index if not exists loyalty_cards_email_once/i.test(schema)
        && state.cards.some(other => other !== row && other.restaurant_id === row.restaurant_id && other.email === patch!.email)) {
        return { data: null, error: { code: "23505", message: "duplicate email" } };
      }
      Object.assign(row, patch);
    }
    return { data: table === "loyalty_cards" ? row ?? null : table === "restaurants" ? { name: "Cafe" }
      : table === "loyalty_redemptions" ? [] : null, error: null };
  };
  const q = { select: () => q, update: (value: Record<string, string | null>) => { patch = value; return q; },
    eq: (key: string, value: string) => { filters[key] = value; return q; }, order: () => q, limit: () => q,
    maybeSingle: async () => answer(), single: async () => answer(),
    then: (done: (value: unknown) => unknown) => Promise.resolve(answer()).then(done) };
  return q;
} }) }));
const { POST } = await import("../route");
const { GET } = await import("@/app/api/rewards/route");
beforeEach(() => { state.cards = []; });

it.each([null, "old@example.invalid"])("saves on this card whether another card has the address, starting with %s", async previous => {
  const answers = [];
  for (const shared of [false, true]) {
    state.cards = [
      { id: "own", code: "K7QM3XW9K7P2", restaurant_id: "r", created_at: "2026-01-01", email: previous },
      { id: "other", code: "OTHER", restaurant_id: "r", email: shared ? "ana@example.invalid" : null },
    ];
    const post = await POST(new NextRequest("https://test/api/loyalty/card-email", { method: "POST", body: JSON.stringify({
      code: "K7QM3XW9K7P2", email: "Ana@Example.invalid", consent: true,
    }) }));
    const rewards = await GET(new NextRequest("https://test/api/rewards?c=K7QM3XW9K7P2"));
    answers.push({ status: post.status, post: await post.json(), rewards: await rewards.json() });
    expect(state.cards[1].email).toBe(shared ? "ana@example.invalid" : null);
  }
  expect(answers[1]).toEqual(answers[0]);
  expect(answers[0].rewards.email).toBe("a***@example.invalid");
});

it("drops the old email index but keeps the unique stop token index", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  expect(schema).toMatch(/drop index if exists loyalty_cards_email_once/i);
  expect(schema).not.toMatch(/create unique index if not exists loyalty_cards_email_once/i);
  expect(schema).toMatch(/create unique index[^;]+email_unsubscribe/i);
});

it("a stop link removes only its own card and an old link cannot remove a replacement", async () => {
  state.cards = [
    { id: "own", code: "K7QM3XW9K7P2", restaurant_id: "r", email: null },
    { id: "other", code: "K7QM3XW9K7P3", restaurant_id: "r", email: null },
  ];
  const { setCardEmail } = await import("@/lib/loyalty/card-email");
  const { POST: stop } = await import("@/app/api/tickets/stop/route");
  await Promise.all(state.cards.map(card => setCardEmail("r", card.code!, "ana@example.invalid", "diner")));
  const oldToken = state.cards[0].email_unsubscribe!;
  const otherToken = state.cards[1].email_unsubscribe!;
  expect(oldToken).not.toBe(otherToken);
  await setCardEmail("r", state.cards[0].code!, "new@example.invalid", "diner");
  const postStop = (token: string) => stop(new NextRequest("https://test/api/tickets/stop", {
    method: "POST", body: JSON.stringify({ token }),
  }));
  expect((await postStop(oldToken)).status).toBe(404);
  expect((await postStop(state.cards[0].email_unsubscribe!)).status).toBe(200);
  expect(state.cards[0].email).toBeNull();
  expect(state.cards[1].email).toBe("ana@example.invalid");
  expect(state.cards[1].email_unsubscribe).toBe(otherToken);
});
