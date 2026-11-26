import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/settings/digest-recipients/route";

const { limit, renew } = vi.hoisted(() => ({ limit: vi.fn(), renew: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r", email: "owner@example.test" }) }));
vi.mock("@/lib/rate-limit", () => ({ isRateLimited: limit }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "en" }));
vi.mock("@/lib/digest-recipients", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/digest-recipients")>(), renewConfirmation: renew,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({
    eq: () => ({ maybeSingle: async () => ({ data: { name: "Bistro" } }) }),
  }) }) }),
}));
vi.mock("@/lib/mail", () => ({ sendMail: async () => ({ sent: true }) }));

function resend(id: unknown) {
  return PATCH(new NextRequest("https://test.example/api/settings/digest-recipients", {
    method: "PATCH", body: JSON.stringify({ action: "resend", id }),
  }));
}

beforeEach(() => {
  limit.mockReset();
  renew.mockReset().mockResolvedValue({ email: "outside@example.test", token: "c".repeat(43) });
});

it("uses the same three-resend budget and lookup for equivalent PostgreSQL UUID spellings", async () => {
  const id = "abcdefab-1234-5678-9abc-abcdef012345";
  limit.mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(false).mockReturnValueOnce(true);
  for (const variant of [id, id.toUpperCase(), `{${id}}`]) expect((await resend(variant)).status).toBe(200);
  expect((await resend(id.replaceAll("-", ""))).status).toBe(429);
  expect(limit.mock.calls).toEqual(Array.from({ length: 4 }, () => [`digest-resend:${id}`, 3, 86_400]));
  expect(renew.mock.calls).toEqual(Array.from({ length: 3 }, () => ["r", id]));
});

it("refuses a malformed id before the limit or lookup", async () => {
  expect((await resend("wrong")).status).toBe(400);
  expect(limit).not.toHaveBeenCalled();
  expect(renew).not.toHaveBeenCalled();
});
