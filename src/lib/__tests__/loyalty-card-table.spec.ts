import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const R = "11111111-1111-4111-8111-111111111111";
const TABLE = "33333333-3333-4333-8333-333333333333";
const SITTING = "44444444-4444-4444-8444-444444444444";
let place: unknown = { table: TABLE };
let sitting: string | null = null;
let member: unknown = null;

vi.mock("@/lib/table-membership", () => ({
  openSittingAt: async () => sitting,
  tableMember: async () => member,
}));
vi.mock("@/lib/loyalty/pass", () => ({
  PASS_SECONDS: 28800,
  readVisitPass: () => ({ place, nonce: "n" }),
  placeLimit: () => ({ bucket: "b", limit: 20, windowSeconds: 60 }),
}));
vi.mock("@/lib/rate-limit", () => ({ PHONES_PER_ADDRESS: 4, clientKey: () => "k", isRateLimited: async () => false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => Response.json({ error: key }, { status }) }));
// Off, so a pass let through answers "program off" before any card is made:
// 409 here means the table rule said yes.
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null }));
vi.mock("@/lib/loyalty/server", () => ({ loyaltyOn: async () => false, programOf: async () => null }));
import { POST } from "@/app/api/loyalty/card/route";

const ask = () => POST(new NextRequest("http://localhost/api/loyalty/card", {
  method: "POST", body: JSON.stringify({ restaurantId: R, pass: "p" }),
}));

beforeEach(() => { place = { table: TABLE }; sitting = null; member = null; });

// The owner's "from the menu, any time": a party sitting down at an empty
// table finds the card before ordering. The table join decision keeps a
// stranger with an old QR from using it once somebody is eating there.
it("takes a table pass while the table is empty", async () => {
  expect((await ask()).status).toBe(409);
});

it("refuses a table pass to a stranger once a party sits down", async () => {
  sitting = SITTING;
  const res = await ask();
  expect(res.status).toBe(403);
  expect(await res.json()).toEqual({ error: "apiErr.tableJoin" });
});

it("takes it from a phone let into that party", async () => {
  sitting = SITTING;
  member = { id: "m1", sessionId: SITTING };
  expect((await ask()).status).toBe(409);
});

it("still needs membership for a pass bound to a sitting", async () => {
  place = { table: TABLE, session: SITTING };
  expect((await ask()).status).toBe(403);
  member = { id: "m1", sessionId: SITTING };
  expect((await ask()).status).toBe(409);
});
