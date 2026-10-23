import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { MEMBER_COOKIE, newMemberToken, hashMemberToken } from "@/lib/table-member-cookie";

const mocks = vi.hoisted(() => ({ join: vi.fn(), pending: vi.fn(), table: vi.fn(), limited: vi.fn() }));
vi.mock("@/lib/table-membership", () => ({ requestTableMember: mocks.join, tableMember: vi.fn() }));
vi.mock("@/lib/table-member-requests", () => ({ pendingPhones: mocks.pending }));
vi.mock("@/lib/table-guard", () => ({ tableOf: mocks.table }));
vi.mock("@/lib/api-guard", () => ({ actingFrontOfHouse: vi.fn() }));
vi.mock("@/lib/loyalty/pass", () => ({ issueVisitPass: () => "visit-pass" }));
vi.mock("@/lib/rate-limit", () => ({
  isRoomLimited: mocks.limited, isTableLimited: async () => false, isRateLimited: async () => false,
  forTheRoom: (n: number) => n, clientKey: () => "phone",
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
import { POST } from "@/app/api/table-membership/route";

const restaurantId = "11111111-1111-1111-1111-111111111111";
const tableId = "22222222-2222-2222-2222-222222222222";
const phone = { id: "pending-phone", tableId, tableLabel: "3", createdAt: "2026-10-23" };
const approved = { status: "approved", sessionId: "current-sitting", diner: "me" };
const token = newMemberToken();
function request(cookie = token): NextRequest {
  return new NextRequest("https://test/api/table-membership", {
    method: "POST", headers: { "Content-Type": "application/json", cookie: `${MEMBER_COOKIE}=${cookie}` },
    // A claimed sitting never selects whose phones this response contains.
    body: JSON.stringify({ restaurantId, tableId, sessionId: "foreign-sitting" }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.join.mockResolvedValue(approved);
  mocks.pending.mockResolvedValue([phone]);
  mocks.table.mockResolvedValue(true);
  mocks.limited.mockResolvedValue(false);
});

it("returns the approved phone's current sitting requests with its admission", async () => {
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...approved, pass: "visit-pass", pending: [phone] });
  expect(mocks.join).toHaveBeenCalledWith(restaurantId, tableId, hashMemberToken(token));
  expect(mocks.pending).toHaveBeenCalledExactlyOnceWith(restaurantId, approved.sessionId);
  expect(response.cookies.get(MEMBER_COOKIE)?.value).toBe(token);
});

it.each(["empty", "pending", "rejected"])("never lists other phones for %s admission", async status => {
  const state = { status, sessionId: status === "empty" ? null : "sitting", diner: "me" };
  mocks.join.mockResolvedValue(state);
  const response = await POST(request());
  expect(await response.json()).toEqual({ ...state, pass: "", pending: [] });
  expect(mocks.pending).not.toHaveBeenCalled();
});

it("keeps a newly issued credential and admission when the pending-list read fails", async () => {
  mocks.pending.mockRejectedValue(new Error("database unavailable"));
  const response = await POST(request("invalid"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ...approved, pass: "visit-pass", pending: null });
  const issued = response.cookies.get(MEMBER_COOKIE);
  expect(issued?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(issued?.httpOnly).toBe(true);
  expect(mocks.join).toHaveBeenCalledWith(restaurantId, tableId, hashMemberToken(issued!.value));
});

it("does not invent admission or issue a credential when joining fails", async () => {
  mocks.join.mockRejectedValue(new Error("database unavailable"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(response.cookies.get(MEMBER_COOKIE)).toBeUndefined();
  expect(mocks.pending).not.toHaveBeenCalled();
});

it("checks the table and rate limit before reading any membership", async () => {
  mocks.table.mockResolvedValue(false);
  expect((await POST(request())).status).toBe(404);
  mocks.limited.mockResolvedValue(true);
  expect((await POST(request())).status).toBe(429);
  expect(mocks.join).not.toHaveBeenCalled();
  expect(mocks.pending).not.toHaveBeenCalled();
});
