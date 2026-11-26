import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";

// The signup route, the settings rename and the database limit must agree on
// one length, or a name the form accepted fails later as a generic 503 or 500.

const mock = vi.hoisted(() => ({
  update: vi.fn((row: Record<string, unknown>) => ({ row, eq: async () => ({ error: null }) })),
  rpc: vi.fn(), after: vi.fn(),
}));
vi.mock("next/server", async original => ({ ...await original<typeof import("next/server")>(), after: mock.after }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update: mock.update }), rpc: mock.rpc }) }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ role: "owner", restaurantId: "r", email: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: () => {} }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: async () => false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));

const { POST: settings } = await import("@/app/api/settings/route");
const { POST: signup } = await import("@/app/api/signup/route");

const post = (handler: (req: NextRequest) => Promise<Response>, path: string, body: object) =>
  handler(new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body) }));
const askSignup = (restaurantName: string) =>
  post(signup, "/api/signup", { restaurantName, email: "owner@example.com", acceptedTerms: true });

beforeEach(() => {
  vi.clearAllMocks();
  mock.rpc.mockResolvedValue({ data: false, error: null });
});

it("signup refuses a name over 80 characters before storing anything, and accepts 80", async () => {
  const res = await askSignup(`  ${"n".repeat(81)}  `);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "apiErr.restaurantNameLength" });
  expect(mock.rpc).not.toHaveBeenCalled();

  expect((await askSignup(`  ${"ñ".repeat(80)}  `)).status).toBe(200);
  expect(mock.rpc.mock.lastCall?.[1].p_restaurant_name).toBe("ñ".repeat(80));
});

it("settings refuses an empty or too-long rename and saves the trimmed name", async () => {
  for (const name of ["   ", "x".repeat(81), 42]) {
    const res = await post(settings, "/api/settings", { name });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "apiErr.restaurantNameLength" });
  }
  expect(mock.update).not.toHaveBeenCalled();
  expect((await post(settings, "/api/settings", { name: "  Casa  " })).status).toBe(200);
  expect(mock.update.mock.calls[0][0]).toEqual({ name: "Casa" });
});

it("has the refusal in both languages and the same limit in the database", () => {
  expect(en.apiErr.restaurantNameLength).toContain("{n}");
  expect(es.apiErr.restaurantNameLength).toContain("{n}");
  const schema = readFileSync("supabase/schema.sql", "utf8");
  expect(schema).toContain("alter table restaurants add constraint restaurants_name_length\n"
    + "  check (char_length(btrim(name)) between 1 and 80) not valid;");
});
