import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

// Admin recheck: suspendedAt was optional, so a lift without it cleared
// whichever suspension existed. Now the route refuses it before any write.
const setSuspension = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => ({ userId: "11111111-1111-4111-8111-111111111111", email: "admin@test.dev" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/admin-suspend", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/admin-suspend")>(), setSuspension }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    const q = {
      select: () => q, eq: () => q, insert: () => q,
      maybeSingle: async () => ({ data: { name: "Cafe", plan: "carta", plan_status: "active", owner_id: null }, error: null }),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return q;
  },
}) }));

const ID = "33333333-3333-4333-8333-333333333333";
const { DELETE } = await import("../route");
const lift = (body: Record<string, unknown>) => DELETE(new NextRequest("https://test.dev/api/admin/restaurants/suspend", {
  method: "DELETE", body: JSON.stringify(body),
}));

beforeEach(() => setSuspension.mockClear());

it("refuses a lift that names no suspension, or a malformed one, without touching the restaurant", async () => {
  for (const body of [{ id: ID }, { id: ID, suspendedAt: null }, { id: ID, suspendedAt: "yesterday" }, { id: ID, suspendedAt: 5 }]) {
    const response = await lift(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "apiErr.suspendedAtRequired" });
  }
  expect(setSuspension).not.toHaveBeenCalled();
});

it("lifts the suspension the admin saw", async () => {
  const at = "2026-11-25T10:00:00.123456+00:00";
  expect((await lift({ id: ID, suspendedAt: at })).status).toBe(200);
  expect(setSuspension).toHaveBeenCalledWith(expect.anything(), ID, null, "admin@test.dev", at);
});

it("has the refusal in both languages", async () => {
  const { messagesFor } = await import("@/lib/i18n");
  for (const locale of ["es", "en"] as const) {
    const text = (messagesFor(locale) as unknown as { apiErr: Record<string, string> }).apiErr.suspendedAtRequired;
    expect(text).toMatch(locale === "es" ? /Vuelve a cargar/ : /Reload/);
  }
});
