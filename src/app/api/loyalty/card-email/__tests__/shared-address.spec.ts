import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashOwnerSecret } from "@/lib/loyalty/owner-secret";

const secret = "A".repeat(43);
const ownerHash = hashOwnerSecret(secret);
const code = "K7QM3XW9K7P2";
const owner = { ownerHash };
const pendingFields = { pending_email: null, pending_email_token_hash: null, pending_email_expires_at: null };
const schema = readFileSync("supabase/schema.sql", "utf8");

function activate(card: Record<string, string | null>, email: string | null): void {
  if (card.email !== email) card.email_unsubscribe = email ? crypto.randomUUID() : null;
  Object.assign(card, pendingFields, { email });
}

const state = vi.hoisted(() => ({ cards: [] as Record<string, string | null>[] }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRoomLimited: async () => false, isRateLimited: async () => false }));
vi.mock("@/lib/loyalty/server", () => ({ CARD_COLUMNS: "id,code", cardState: async () => ({ ladder: [] }) }));
vi.mock("@/lib/loyalty/face", () => ({ cardFace: () => ({ qrPayload: "url", standing: {} }) }));
vi.mock("@/lib/loyalty/qr-grid", () => ({ qrGrid: () => [] }));
vi.mock("@/lib/loyalty/card-email-confirmation", () => ({ sendCardEmailConfirmation: async () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string, args: Record<string, string | null>) => {
  const unexpired = (row: Record<string, string | null>) => Date.parse(row.pending_email_expires_at ?? "") > Date.now();
  if (name === "confirm_card_email") {
    const card = state.cards.find(row => row.pending_email_token_hash === args.p_token_hash && unexpired(row));
    if (card) activate(card, card.pending_email);
    return { data: Boolean(card), error: null };
  }
  const card = state.cards.find(row => (!args.p_restaurant || row.restaurant_id === args.p_restaurant) && row.code === args.p_code);
  if (!card) return { data: "unknown", error: null };
  if (!args.p_actor && card.owner_secret_hash !== args.p_owner_hash) return { data: "forbidden", error: null };
  if (args.p_email === null || args.p_email === card.email) {
    activate(card, args.p_email);
    return { data: args.p_email ? "saved" : "removed", error: null };
  }
  if (args.p_email === card.pending_email && unexpired(card)) return { data: "pending", error: null };
  Object.assign(card, { pending_email: args.p_email, pending_email_token_hash: args.p_token_hash,
    pending_email_expires_at: new Date(Date.now() + 7 * 86400_000).toISOString() });
  return { data: "submitted", error: null };
}, from: (table: string) => {
  const filters: Record<string, string> = {};
  let patch: Record<string, string | null> | undefined;
  const answer = () => {
    const rows = state.cards.filter(row => Object.entries(filters).every(([key, value]) => row[key] === value));
    const row = rows[0];
    if (table === "loyalty_cards" && patch && row) {
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
const { POST: confirm } = await import("@/app/api/tickets/confirm/route");
const { setCardEmail } = await import("@/lib/loyalty/card-email");
const confirmToken = (token: string) => confirm(new NextRequest("https://test/api/tickets/confirm", {
  method: "POST", body: JSON.stringify({ token }),
}));
async function pendingToken(cardCode: string, email: string): Promise<string> {
  const result = await setCardEmail(cardCode, email, owner);
  if (result.outcome !== "submitted") throw new Error("Expected one new confirmation");
  return result.token;
}
async function link(cardCode: string, email: string): Promise<void> {
  expect((await confirmToken(await pendingToken(cardCode, email))).status).toBe(200);
}
beforeEach(() => { state.cards = []; });

it.each([null, "old@example.invalid"])("saves on this card whether another card has the address, starting with %s", async previous => {
  const answers = [];
  for (const shared of [false, true]) {
    state.cards = [
      { id: "own", code, restaurant_id: "r", created_at: "2026-01-01", email: previous, owner_secret_hash: ownerHash },
      { id: "other", code: "OTHER", restaurant_id: "r", email: shared ? "ana@example.invalid" : null },
    ];
    const post = await POST(new NextRequest("https://test/api/loyalty/card-email", {
      method: "POST", headers: { cookie: `tt-loyalty-email-owner-${code}=${secret}` }, body: JSON.stringify({
      code, email: "Ana@Example.invalid", consent: true,
    }) }));
    const rewards = await GET(new NextRequest("https://test/api/rewards?c=K7QM3XW9K7P2"));
    answers.push({ status: post.status, post: await post.json(), rewards: await rewards.json() });
    expect(state.cards[1].email).toBe(shared ? "ana@example.invalid" : null);
  }
  expect(answers[1]).toEqual(answers[0]);
  expect(answers[0].status).toBe(200);
  expect(answers[0].post).toEqual({ outcome: "submitted" });
  expect(answers[0].rewards.email).toBe(previous ? "o***@example.invalid" : null);
});

it("drops the old email index but keeps the unique stop token index", () => {
  expect(schema).toMatch(/drop index if exists loyalty_cards_email_once/i);
  expect(schema).not.toMatch(/create unique index if not exists loyalty_cards_email_once/i);
  expect(schema).toMatch(/create unique index[^;]+email_unsubscribe/i);
});

it("a stop link removes only its own card and an old link cannot remove a replacement", async () => {
  state.cards = [
    { id: "own", code, restaurant_id: "r", email: null, owner_secret_hash: ownerHash },
    { id: "other", code: "K7QM3XW9K7P3", restaurant_id: "r", email: null, owner_secret_hash: ownerHash },
  ];
  const { POST: stop } = await import("@/app/api/tickets/stop/route");
  await Promise.all(state.cards.map(card => link(card.code!, "ana@example.invalid")));
  const oldToken = state.cards[0].email_unsubscribe!;
  const otherToken = state.cards[1].email_unsubscribe!;
  expect(oldToken).not.toBe(otherToken);
  await link(code, "new@example.invalid");
  const postStop = (token: string) => stop(new NextRequest("https://test/api/tickets/stop", {
    method: "POST", body: JSON.stringify({ token }),
  }));
  expect((await postStop(oldToken)).status).toBe(404);
  expect((await postStop(state.cards[0].email_unsubscribe!)).status).toBe(200);
  expect(state.cards[0].email).toBeNull();
  expect(state.cards[1].email).toBe("ana@example.invalid");
  expect(state.cards[1].email_unsubscribe).toBe(otherToken);
});

it("a repeated same-address save keeps the delivered stop link on its own card", async () => {
  state.cards = [
    { id: "own", code, restaurant_id: "r", email: null, owner_secret_hash: ownerHash },
    { id: "other", code: "K7QM3XW9K7P3", restaurant_id: "r", email: null, owner_secret_hash: ownerHash },
  ];
  const { POST: stop } = await import("@/app/api/tickets/stop/route");
  await link(code, "ana@example.invalid");
  await link(state.cards[1].code!, "ana@example.invalid");
  const token = state.cards[0].email_unsubscribe!;
  await setCardEmail(code, "ana@example.invalid", owner);
  expect(state.cards[0].email_unsubscribe).toBe(token);
  const response = await stop(new NextRequest("https://test/api/tickets/stop", { method: "POST", body: JSON.stringify({ token }) }));
  expect(response.status).toBe(200);
  expect(state.cards[0].email).toBeNull();
  expect(state.cards[1].email).toBe("ana@example.invalid");
});

it("keeps the locked write, staff audit and promotion scoped to the service role", () => {
  const setter = schema.split("create or replace function public.set_card_email_v2(")[1].split("$$;")[0];
  expect(setter).toContain("for update");
  expect(setter).toContain("card.owner_secret_hash is distinct from p_owner_hash");
  expect(setter).toMatch(/if p_actor is not null then\s+insert into public\.user_logs/);
  expect(setter).toContain("clock_timestamp() + interval '7 days'");
  for (const signature of ["set_card_email_v2(uuid, text, text, text, text, text, text)", "confirm_card_email(text)"]) {
    expect(schema).toContain(`revoke all on function public.${signature} from public, anon, authenticated;`);
    expect(schema).toContain(`grant execute on function public.${signature} to service_role;`);
  }
  const promoter = schema.split("create or replace function public.confirm_card_email(")[1].split("$$;")[0];
  expect(promoter).toContain("email = pending_email, email_unsubscribe = gen_random_uuid()");
  expect(promoter).toContain("pending_email_token_hash = null");
  expect(promoter).toContain("where pending_email_token_hash = p_token_hash and pending_email_expires_at > clock_timestamp()");
});

it("removing and re-adding an address starts a new consent generation", async () => {
  state.cards = [{ id: "own", code, restaurant_id: "r", email: null, owner_secret_hash: ownerHash }];
  await link(code, "ana@example.invalid");
  const token = state.cards[0].email_unsubscribe;
  await setCardEmail(code, null, owner);
  await link(code, "ana@example.invalid");
  expect(state.cards[0].email_unsubscribe).not.toBe(token);
});

it("preserves the active destination until confirmation and consumes the token", async () => {
  const card = { code, email: "old@example.invalid", email_unsubscribe: "old-key", owner_secret_hash: ownerHash };
  state.cards = [card];
  const token = await pendingToken(code, "new@example.invalid");
  expect(card.email).toBe("old@example.invalid");
  expect(card.email_unsubscribe).toBe("old-key");
  expect((await confirmToken(token)).status).toBe(200);
  expect(card.email).toBe("new@example.invalid");
  expect(card.email_unsubscribe).not.toBe("old-key");
  expect((await confirmToken(token)).status).toBe(404);
});

it.each(["expired", "replaced", "removed"])("rejects a %s confirmation", async reason => {
  const card = { code, email: "old@example.invalid", owner_secret_hash: ownerHash, ...pendingFields };
  state.cards = [card];
  const token = await pendingToken(code, "new@example.invalid");
  if (reason === "expired") state.cards[0].pending_email_expires_at = new Date(0).toISOString();
  if (reason === "replaced") await pendingToken(code, "replacement@example.invalid");
  if (reason === "removed") await setCardEmail(code, null, owner);
  expect((await confirmToken(token)).status).toBe(404);
  expect(card.email).toBe(reason === "removed" ? null : "old@example.invalid");
});
