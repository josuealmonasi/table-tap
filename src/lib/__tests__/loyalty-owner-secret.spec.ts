import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";
import type { Role } from "@/lib/membership";
import { POST as createCard } from "@/app/api/loyalty/card/route";
import { GET, PATCH, DELETE } from "@/app/api/rewards/route";
import { DELETE as managerDelete } from "@/app/api/loyalty/lookup/route";

const db = vi.hoisted(() => ({
  insert: vi.fn(), update: vi.fn(), delete: vi.fn(), rpc: vi.fn(), getMember: vi.fn(),
  select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), single: vi.fn(), order: vi.fn(), limit: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => db, rpc: db.rpc }) }));
vi.mock("@/lib/membership", async original => ({ ...await original<typeof import("@/lib/membership")>(), getMember: db.getMember }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/rate-limit", () => ({ PHONES_PER_ADDRESS: 20, clientKey: () => "ip", isRateLimited: async () => false }));
vi.mock("@/lib/table-membership", () => ({}));
vi.mock("@/lib/loyalty/pass", () => ({ readVisitPass: () => ({ place: "counter" }), placeLimit: () => ({}), PASS_SECONDS: 1 }));
const steps = [{ visits: 8, reward: "Coffee" }];
vi.mock("@/lib/loyalty/server", () => ({
  CARD_COLUMNS: "id, goal, steps, round_no",
  loyaltyOn: async () => true,
  programOf: async () => ({ goal: 8, steps }),
  cardState: async () => ({ progress: 0, done: [], ladder: steps }),
}));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));

const code = "K7QM3XW9K7P2";
const cookieName = `tt-loyalty-owner-${code}`;
const secret = "A".repeat(43);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const restaurant = "10000000-0000-4000-8000-000000000001";
const rewards = (method: string, cookie?: string) => new NextRequest(`https://test/api/rewards?c=${code}`, {
  method, headers: cookie ? { cookie } : {},
});

beforeEach(() => {
  vi.resetAllMocks();
  db.update.mockReturnValue(db);
  db.delete.mockReturnValue(db);
  db.select.mockReturnValue(db);
  db.eq.mockReturnValue(db);
  db.order.mockReturnValue(db);
  db.limit.mockReturnValue(db);
  db.maybeSingle.mockResolvedValue({ data: { id: "card", owner_secret_hash: hash(secret) }, error: null });
  db.getMember.mockResolvedValue({ membership: null });
});

it("shows whether this browser can delete the card without exposing its key or hash", async () => {
  db.maybeSingle.mockResolvedValue({ data: {
    id: "card", restaurant_id: restaurant, created_at: "2026-11-24", owner_secret_hash: hash(secret),
  }, error: null });
  db.single.mockResolvedValue({ data: { name: "Cafe" }, error: null });
  const owner = await GET(rewards("GET", `${cookieName}=${secret}`));
  const guest = await GET(rewards("GET"));
  expect(owner.headers.get("cache-control")).toBe("private, no-store");
  const body = await owner.json();
  expect(body.canDelete).toBe(true);
  expect(JSON.stringify(body)).not.toContain(secret);
  expect(JSON.stringify(body)).not.toContain(hash(secret));
  expect((await guest.json()).canDelete).toBe(false);
});

it("creates a different random HttpOnly deletion key for each card and stores just its SHA-256", async () => {
  db.maybeSingle.mockResolvedValue({ data: { name: "Cafe" }, error: null });
  db.insert.mockResolvedValue({ error: null });
  const keys = [];
  for (let card = 0; card < 2; card++) {
    const response = await createCard(new NextRequest("https://test/api/loyalty/card", {
      method: "POST", body: JSON.stringify({ restaurantId: restaurant }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const cookie = response.cookies.get(`tt-loyalty-owner-${body.code}`);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/api/rewards" });
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const key = cookie!.value;
    expect(db.insert).toHaveBeenLastCalledWith({
      code: body.code, restaurant_id: restaurant, goal: 8,
      steps: [{ visits: 8, reward: "Coffee" }], owner_secret_hash: hash(key),
    });
    expect(JSON.stringify(body)).not.toContain(key);
    expect(JSON.stringify(body)).not.toContain(hash(key));
    keys.push(key);
  }
  expect(keys[0]).not.toBe(keys[1]);
});

it("renews the owner's cookie when the card is saved again", async () => {
  const response = await PATCH(rewards("PATCH", `${cookieName}=${secret}`));
  expect(response.status).toBe(200);
  expect(response.cookies.get(cookieName)).toMatchObject({ value: secret, httpOnly: true, maxAge: 365 * 86400 });
  expect(db.update).toHaveBeenCalledWith({ saved_at: expect.any(String) });
  expect(await response.json()).toEqual({ ok: true });
});

it.each([hash(secret), null])("never grants deletion authority on a save by another phone (hash %s)", async owner_secret_hash => {
  db.maybeSingle.mockResolvedValue({ data: { owner_secret_hash }, error: null });
  const response = await PATCH(rewards("PATCH", `${cookieName}=${"B".repeat(43)}`));
  expect(response.status).toBe(200);
  expect(response.cookies.get(cookieName)).toBeUndefined();
  expect(db.update).toHaveBeenCalledWith({ saved_at: expect.any(String) });
});

it("checks the code and cookie hash in the same delete and clears the cookie on success", async () => {
  db.select.mockResolvedValue({ data: [{ id: "card" }], error: null });
  const response = await DELETE(rewards("DELETE", `${cookieName}=${secret}`));
  expect(response.status).toBe(200);
  expect(db.eq.mock.calls).toEqual([["code", code], ["owner_secret_hash", hash(secret)]]);
  expect(response.cookies.get(cookieName)).toMatchObject({ value: "", maxAge: 0, path: "/api/rewards" });
});

it.each([undefined, `tt-loyalty-owner-000000000000=${secret}`])("a code without its own cookie cannot delete a card", async cookie => {
  const response = await DELETE(rewards("DELETE", cookie));
  expect(response.status).toBe(403);
  expect(await response.json()).toEqual({ error: "Ask the restaurant to delete this card for you." });
  expect(db.delete).not.toHaveBeenCalled();
});

it.each([hash(secret), null])("refuses deletion when the cookie has no matching hash (hash %s)", async owner_secret_hash => {
  db.maybeSingle.mockResolvedValue({ data: { id: "card", owner_secret_hash }, error: null });
  db.select.mockResolvedValueOnce({ data: [], error: null });
  const wrongSecret = "B".repeat(43);
  const response = await DELETE(rewards("DELETE", `${cookieName}=${wrongSecret}`));
  expect(db.eq).toHaveBeenCalledWith("owner_secret_hash", hash(wrongSecret));
  expect(response.status).toBe(403);
  expect(response.cookies.get(cookieName)).toBeUndefined();
});

it("returns 404 for a card that no longer exists", async () => {
  db.maybeSingle.mockResolvedValue({ data: null, error: null });
  expect((await DELETE(rewards("DELETE"))).status).toBe(404);
});

const lookup = () => new NextRequest(`https://test/api/loyalty/lookup?c=${code}`, { method: "DELETE" });
function signIn(role: Role, restaurantId = restaurant): void {
  db.getMember.mockResolvedValue({ user: { email: "staff@example.invalid" }, membership: { role, restaurant: { id: restaurantId } } });
}

it.each([null, "waiter", "cashier", "kitchen"] as const)("forbids staff deletion by %s", async role => {
  if (role) signIn(role);
  expect((await managerDelete(lookup())).status).toBe(403);
  expect(db.rpc).not.toHaveBeenCalled();
});

it.each(["owner", "manager"] as const)("allows %s to delete and audit a card in their own restaurant", async role => {
  signIn(role);
  db.rpc.mockResolvedValue({ data: true, error: null });
  const response = await managerDelete(lookup());
  expect(response.status).toBe(200);
  expect(db.rpc).toHaveBeenCalledWith("loyalty_delete_card", {
    p_restaurant: restaurant, p_code: code, p_actor: "staff@example.invalid",
  });
});

it("scopes the audited deletion to the signed-in manager's restaurant", async () => {
  const other = "20000000-0000-4000-8000-000000000002";
  signIn("manager", other);
  db.rpc.mockResolvedValue({ data: false, error: null });
  expect((await managerDelete(lookup())).status).toBe(404);
  expect(db.rpc).toHaveBeenCalledWith("loyalty_delete_card", {
    p_restaurant: other, p_code: code, p_actor: "staff@example.invalid",
  });
});
