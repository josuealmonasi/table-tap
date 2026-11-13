import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Review access2: a diner's "taken" said whether an address had a card at the
// restaurant, five times an hour for every card the caller held.
const f = vi.hoisted(() => ({ actor: null as null | { restaurantId: string; email: string; role: string },
  outcome: { outcome: "saved", email: "ana@example.invalid" } as Record<string, unknown>, limited: new Set<string>(),
  buckets: [] as string[] }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => f.actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "ip-key",
  isRoomLimited: async () => false,
  isRateLimited: async (bucket: string) => { f.buckets.push(bucket); return [...f.limited].some(b => bucket.startsWith(b)); },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { restaurant_id: "r1" }, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/loyalty/card-email", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/loyalty/card-email")>()),
  setCardEmail: async () => f.outcome,
}));
const { POST } = await import("../route");
const post = () => POST(new NextRequest("https://test/api/loyalty/card-email", { method: "POST",
  body: JSON.stringify({ code: "K7QM-3XW9-K7P2", email: "Ana@Example.invalid", consent: true }) }));
beforeEach(() => { f.actor = null; f.limited.clear(); f.buckets = []; });

it("answers a diner the same whether the address was linked or is on another card", async () => {
  f.outcome = { outcome: "saved", email: "ana@example.invalid" };
  const saved = await post();
  f.outcome = { outcome: "taken", suffix: "ABCD" };
  const taken = await post();
  expect(taken.status).toBe(saved.status);
  expect(saved.status).toBe(200);
  expect(await taken.json()).toEqual(await saved.json());
});

it("still tells staff which card holds the address", async () => {
  f.actor = { restaurantId: "r1", email: "staff@test", role: "waiter" };
  f.outcome = { outcome: "taken", suffix: "ABCD" };
  const res = await post();
  expect(res.status).toBe(409);
  expect(await res.json()).toEqual({ outcome: "taken", suffix: "ABCD" });
});

it("limits a diner per card and per network address", async () => {
  await post();
  expect(f.buckets).toEqual(["card-email:K7QM3XW9K7P2", "card-email-diner:ip-key"]);
  f.limited.add("card-email-diner:");
  expect((await post()).status).toBe(429);
  f.limited.clear(); f.limited.add("card-email:");
  expect((await post()).status).toBe(429);
});
