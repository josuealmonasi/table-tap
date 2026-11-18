import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Security review 2026-11-17, findings 2 and 4: two rate limits that capped the
// answer but not the cost, or capped the wrong thing.
const state = vi.hoisted(() => ({ limited: new Set<string>(), authCalls: 0, saved: [] as unknown[] }));

vi.mock("@/lib/rate-limit", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  clientKey: () => "1.2.3.4",
  forTheRoom: (n: number) => n,
  perMinute: () => 60,
  isRoomLimited: async () => false,
  isRateLimited: async (key: string) => [...state.limited].some(prefix => key.startsWith(prefix)),
}));
vi.mock("@/lib/api-guard", () => ({
  actingFrontOfHouse: async () => { state.authCalls++; return null; },
}));
vi.mock("@/lib/api-error", () => ({
  apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit"]) q[m] = () => q;
    q.maybeSingle = async () => ({ data: { restaurant_id: "11111111-1111-4111-8111-111111111111" }, error: null });
    return { from: () => q, rpc: async () => ({ data: null, error: null }) };
  },
}));
vi.mock("@/lib/loyalty/card-email", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/loyalty/card-email")>()),
  setCardEmail: async (_r: string, _c: string, email: string | null) => {
    state.saved.push(email);
    return email ? { outcome: "saved", email } : { outcome: "removed" };
  },
}));

const R = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  state.limited.clear(); state.authCalls = 0; state.saved.length = 0;
});

describe("the floor's membership poll", () => {
  it("answers a caller over the limit without checking who they are", async () => {
    const { GET } = await import("@/app/api/table-membership/route");
    state.limited.add("table-member-list:");
    const res = await GET(new NextRequest(`http://x/api/table-membership?restaurantId=${R}`));
    expect(res.status).toBe(429);
    // The session check and the membership reads it leads to never started.
    expect(state.authCalls).toBe(0);
  });
});

describe("a diner's card email", () => {
  const post = async (body: unknown) => {
    const { POST } = await import("@/app/api/loyalty/card-email/route");
    return await POST(new NextRequest("http://x/api/loyalty/card-email", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  };

  it("can always be removed, even when the Wi-Fi's shared allowance is spent", async () => {
    state.limited.add("card-email-diner:");
    state.limited.add("card-email:");
    const res = await post({ code: "ABCD2345EFGH", email: null });
    expect(res.status).toBe(200);
    expect(state.saved).toEqual([null]);
  });

  it("still limits linking new addresses from that network", async () => {
    state.limited.add("card-email-diner:");
    const res = await post({ code: "ABCD2345EFGH", email: "ana@example.com", consent: true });
    expect(res.status).toBe(429);
    expect(state.saved).toEqual([]);
  });
});

describe("a manager's dispute history read", () => {
  it("answers an empty request without reading any dispute, and caps repeated reads", async () => {
    vi.doMock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: R, email: "m@x.dev", role: "manager" }) }));
    const read = vi.fn(async () => ({}));
    vi.doMock("@/lib/disputes/read", () => ({ readDisputeHistory: read }));
    vi.resetModules();
    const { GET } = await import("@/app/api/disputes/history/route");
    const empty = await GET(new NextRequest("http://x/api/disputes/history"));
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({});
    expect(read).not.toHaveBeenCalled();

    state.limited.add("dispute-history:");
    const capped = await GET(new NextRequest(`http://x/api/disputes/history?order=${R}`));
    expect(capped.status).toBe(429);
    expect(read).not.toHaveBeenCalled();
  });
});
