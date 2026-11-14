import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { splitTipPrincipal, splitTipBase, tipFromPercent } from "@/lib/tip-base";
const f = vi.hoisted(() => ({ taken: false, email: null as string | null }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: async () => null }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRoomLimited: async () => false, isRateLimited: async () => false }));
vi.mock("@/lib/loyalty/card-email", async original => ({ ...await original<typeof import("@/lib/loyalty/card-email")>(),
  setCardEmail: async () => {
    if (f.taken) return { outcome: "taken" };
    f.email = "ana@example.invalid";
    return { outcome: "saved", email: f.email };
  },
}));
vi.mock("@/lib/loyalty/server", () => ({ CARD_COLUMNS: "id,code", cardState: async () => ({ ladder: [] }) }));
vi.mock("@/lib/loyalty/face", () => ({ cardFace: () => ({ qrPayload: "url", standing: {} }) }));
vi.mock("@/lib/loyalty/qr-grid", () => ({ qrGrid: () => [] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => {
  const answer = () => ({ data: table === "loyalty_cards" ? { id: "own-card", restaurant_id: "r1", created_at: "2026-01-01", email: f.email }
    : table === "restaurants" ? { name: "Cafe" } : table === "loyalty_redemptions" ? [] : null, error: null });
  const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
    maybeSingle: async () => answer(), single: async () => answer(),
    then: (done: (v: unknown) => unknown) => Promise.resolve(answer()).then(done) };
  return q;
} }) }));
import { POST } from "@/app/api/loyalty/card-email/route";
import { GET } from "@/app/api/rewards/route";
beforeEach(() => { f.taken = false; f.email = null; });
// Known P3: hiding the POST outcome cannot hide the later association read.
// Ownership verification changes the linking flow and is deferred from this fix.
it.fails("N12: subsequent rewards reads must not reveal whether the submitted address is taken", async () => {
  const answers = [];
  for (const taken of [false, true]) {
    f.taken = taken; f.email = null;
    await POST(new NextRequest("https://test/api/loyalty/card-email", { method: "POST", body: JSON.stringify({
      code: "K7QM-3XW9-K7P2", email: "ana@example.invalid", consent: true,
    }) }));
    answers.push((await (await GET(new NextRequest("https://test/api/rewards?c=K7QM3XW9K7P2"))).json()).email);
  }
  expect(answers[1]).toEqual(answers[0]);
});
// Known P3: amount includes original tips; subtracting today's tips instead
// would also subtract later share tips. Historical evidence needs its own fix.
it.fails("N14: existing gratuities must not become suggested legacy split tips", () => {
  const split = { food_principal: null, amount: 120 };
  for (const orders of [[{ total: 120, tip: 20 }], [{ total: 125, tip: 25, collected: 65, collected_tip: 15 }]]) {
    expect(tipFromPercent(splitTipBase(splitTipPrincipal(split, orders), 2, [1]), 10)).toBe(5);
  }
});
