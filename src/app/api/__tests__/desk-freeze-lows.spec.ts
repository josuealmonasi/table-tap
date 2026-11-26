import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// Desk writes that ignored a locked subscription (billing recheck, 2026-11-25):
// an account's ceiling, code and closing, a loyalty card's deletion, a stamp's
// undo and the digest's extra recipients. Each must answer the freeze before it
// reads a body or touches the database. Collecting money stays open.
const state = vi.hoisted(() => ({ frozen: true, work: vi.fn() }));
const actor = { restaurantId: "r", role: "owner", email: "owner@test" };
vi.mock("@/lib/api-guard", () => ({
  actingFrontOfHouse: async () => actor, actingManager: async () => actor, actingOwner: async () => actor,
}));
vi.mock("@/lib/plan-guard", () => ({
  frozenBlocks: async () => state.frozen ? NextResponse.json({ error: "plan.frozen" }, { status: 402 }) : null,
  planBlocks: async () => null,
}));
vi.mock("@/lib/api-error", () => ({ apiError: async (key: string, status: number) => NextResponse.json({ error: key }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => { state.work(); throw new Error("database reached"); } }));
vi.mock("@/lib/accounts-server", () => ({
  accountById: async () => { state.work(); return null; }, accountByCode: async () => null,
  listAccounts: async () => [], statementOf: async () => null,
}));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: async () => { state.work(); return false; } }));
vi.mock("@/lib/digest-recipients", () => ({
  MAX_DIGEST_RECIPIENTS: 5, confirmationMail: () => ({}),
  addRecipient: async () => { state.work(); return { outcome: "full" }; },
  listRecipients: async () => { state.work(); return []; },
  removeRecipient: async () => { state.work(); return false; },
  renewConfirmation: async () => { state.work(); return null; },
}));

const accounts = await import("@/app/api/accounts/route");
const lookup = await import("@/app/api/loyalty/lookup/route");
const visit = await import("@/app/api/loyalty/visit/route");
const digest = await import("@/app/api/settings/digest-recipients/route");

const id = "00000000-0000-4000-8000-000000000001";
const call = (url: string, method: string, body?: object) =>
  new NextRequest(`https://test${url}`, { method, body: body ? JSON.stringify(body) : undefined });

const cases = [
  ["accounts PATCH limit", () => accounts.PATCH(call("/api/accounts", "PATCH", { id, action: "limit", limit: 500, currency: "MXN" }))],
  ["accounts PATCH code", () => accounts.PATCH(call("/api/accounts", "PATCH", { id, action: "code" }))],
  ["accounts PATCH close", () => accounts.PATCH(call("/api/accounts", "PATCH", { id, action: "close" }))],
  ["loyalty card DELETE", () => lookup.DELETE(call("/api/loyalty/lookup?c=ABCD-EFGH-JKMN", "DELETE"))],
  ["loyalty visit DELETE", () => visit.DELETE(call("/api/loyalty/visit", "DELETE", { id }))],
  ["digest recipient POST", () => digest.POST(call("/api/settings/digest-recipients", "POST", { email: "a@b.mx" }))],
  ["digest recipient PATCH resend", () => digest.PATCH(call("/api/settings/digest-recipients", "PATCH", { id, action: "resend" }))],
  ["digest recipient DELETE", () => digest.DELETE(call("/api/settings/digest-recipients", "DELETE", { id }))],
] as const;

beforeEach(() => {
  state.frozen = true;
  state.work.mockClear();
});

describe("desk writes refuse a locked subscription", () => {
  it.each(cases)("%s answers 402 before any work", async (_name, run) => {
    const res = await run();
    expect(res.status).toBe(402);
    expect(((await res.json()) as { error: string }).error).toBe("plan.frozen");
    expect(state.work).not.toHaveBeenCalled();
  });

  it.each(cases)("%s goes on to its work when the subscription is open", async (_name, run) => {
    state.frozen = false;
    await run().catch(() => undefined);
    expect(state.work).toHaveBeenCalled();
  });

  it("leaves collecting and forgiving what is owed open while frozen (owner decision)", () => {
    for (const route of ["accounts/credit", "accounts/settle", "loyalty/redeem"]) {
      expect(readFileSync(`src/app/api/${route}/route.ts`, "utf8")).not.toContain("frozenBlocks");
    }
  });
});
