import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { hashOwnerSecret } from "@/lib/loyalty/owner-secret";

const secret = "A".repeat(43);
const code = "K7QM3XW9K7P2";

// Review access2: a diner's "taken" said whether an address had a card at the
// restaurant, five times an hour for every card the caller held.
const f = vi.hoisted(() => ({ actor: null as null | { restaurantId: string; email: string; role: string },
  outcome: { outcome: "saved", email: "ana@example.invalid" } as Record<string, unknown>, limited: new Set<string>(),
  buckets: [] as string[], hash: null as string | null, write: vi.fn(), send: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => f.actor }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({
  clientKey: () => "ip-key",
  isRoomLimited: async () => false,
  isRateLimited: async (bucket: string) => { f.buckets.push(bucket); return [...f.limited].some(b => bucket.startsWith(b)); },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { owner_secret_hash: f.hash }, error: null }) };
  return q;
} }) }));
vi.mock("@/lib/loyalty/card-email", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/loyalty/card-email")>()),
  setCardEmail: (...args: unknown[]) => { f.write(...args); return f.outcome; },
}));
vi.mock("@/lib/loyalty/card-email-confirmation", () => ({
  sendCardEmailConfirmation: (...args: unknown[]) => f.send(...args),
}));
const { POST } = await import("../route");
const post = (ownerSecret: string | null = secret, email: string | null = "Ana@Example.invalid") =>
  POST(new NextRequest("https://test/api/loyalty/card-email", { method: "POST",
    headers: ownerSecret ? { cookie: `tt-loyalty-email-owner-${code}=${ownerSecret}` } : {},
    body: JSON.stringify({ code: "K7QM-3XW9-K7P2", email, consent: true }) }));
beforeEach(() => {
  f.actor = null; f.limited.clear(); f.buckets = [];
  f.hash = hashOwnerSecret(secret); f.write.mockReset(); f.send.mockReset();
  f.outcome = { outcome: "pending" };
});

it("sends one inbox confirmation for a new pending diner address", async () => {
  f.outcome = { outcome: "submitted", token: "token" };
  const res = await post();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ outcome: "submitted" });
  expect(f.write).toHaveBeenCalledWith(code, "ana@example.invalid", { ownerHash: f.hash });
  expect(f.send).toHaveBeenCalledWith(expect.any(NextRequest), code, "ana@example.invalid", "token");
  f.outcome = { outcome: "pending" };
  expect(await (await post()).json()).toEqual({ outcome: "submitted" });
  expect(f.send).toHaveBeenCalledTimes(1);
});

it.each([null, "B".repeat(43)])("refuses a change or removal without the matching secret (%s)", async wrongSecret => {
  expect((await post(wrongSecret)).status).toBe(403);
  expect((await post(wrongSecret, null)).status).toBe(403);
  expect(f.write).not.toHaveBeenCalled();
  expect(f.send).not.toHaveBeenCalled();
  expect(f.buckets).toEqual([]);
});

it("does not authorize a legacy card that has no owner secret", async () => {
  f.hash = null;
  expect((await post()).status).toBe(403);
  expect(f.write).not.toHaveBeenCalled();
});

it("shows staff the saved address in their permitted form", async () => {
  f.actor = { restaurantId: "r1", email: "staff@test", role: "waiter" };
  f.outcome = { outcome: "saved", email: "ana@example.invalid" };
  const res = await post(null);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ outcome: "saved", email: "a***@example.invalid" });
  expect(f.write).toHaveBeenCalledWith(code, "ana@example.invalid", { restaurantId: "r1", actor: "staff@test" });
});

it("lets front-of-house staff remove an email without the owner cookie", async () => {
  f.actor = { restaurantId: "r1", email: "staff@test", role: "waiter" };
  f.outcome = { outcome: "removed" };
  expect(await (await post(null, null)).json()).toEqual({ outcome: "removed" });
  expect(f.write).toHaveBeenCalledWith(code, null, { restaurantId: "r1", actor: "staff@test" });
});

it("limits a diner per card and per network address", async () => {
  await post();
  expect(f.buckets).toEqual(["card-email:K7QM3XW9K7P2", "card-email-diner:ip-key"]);
  f.limited.add("card-email-diner:");
  expect((await post()).status).toBe(429);
  f.limited.clear(); f.limited.add("card-email:");
  expect((await post()).status).toBe(429);
});
