import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "client", isRateLimited: async () => false }));
vi.mock("@/lib/mail", () => ({ mailConfigured: () => false }));
vi.mock("@/lib/account-checkout-state", () => ({ unresolvedAccounts: async () => new Set() }));
vi.mock("@/lib/accounts-server", () => ({
  accountByCode: async () => ({ id: "account", restaurant_id: "restaurant", name: "Guest", status: "open" }),
  statementOf: async () => ({ owed: 40, currency: "MXN", balances: [], payments: [], returns: [], chargedBy: { order: "private@test" },
    days: [{ day: "2026-11-10", total: 40, charges: [{ orderId: "order", at: "2026-11-10T12:00:00Z", total: 40, lines: [], tableLabel: null,
      credits: [{ at: "2026-11-10T13:00:00Z", amount: 10, currency: "MXN", actor: "private@test", reason: "error", note: "private dispute" }] }] }] }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { id: "restaurant", name: "Place", currency: "MXN", timezone: "UTC" }, error: null }) }; return q;
} }) }));
import { GET } from "@/app/api/account/route";
it("public statements explicitly expose credit amount/date/currency only", async () => {
  const response = await GET(new NextRequest("https://test/api/account?c=123456789ABC"));
  expect(response.status).toBe(200); const data = await response.json();
  expect(data.days[0].charges[0].credits).toEqual([{ at: "2026-11-10T13:00:00Z", amount: 10, currency: "MXN" }]);
  expect(JSON.stringify(data)).not.toMatch(/private|orderId|chargedBy|actor|reason|note/);
});
