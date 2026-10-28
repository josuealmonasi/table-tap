import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Codex's review of #560: posting only one threshold reset the other to the
// default (late 60 became 20). The route now keeps the saved value.
const state = vi.hoisted(() => ({ saved: { ticket_warn_minutes: 10, ticket_late_minutes: 60 }, written: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.saved, error: null }) }) }),
  update: (patch: unknown) => { state.written = patch; return { eq: async () => ({ error: null }) }; },
}) }) }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ role: "manager", restaurantId: "r", email: "m" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
const { POST } = await import("@/app/api/settings/route");
const post = (body: object) => POST(new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) }));
beforeEach(() => { state.written = null; state.saved = { ticket_warn_minutes: 10, ticket_late_minutes: 60 }; });

it("keeps the saved late threshold when only warn is posted", async () => {
  expect((await post({ ticket_warn_minutes: 15 })).status).toBe(200);
  expect(state.written).toMatchObject({ ticket_warn_minutes: 15, ticket_late_minutes: 60 });
});
it("keeps the saved warn threshold when only late is posted, still after it", async () => {
  expect((await post({ ticket_late_minutes: 5 })).status).toBe(200);
  expect(state.written).toMatchObject({ ticket_warn_minutes: 10, ticket_late_minutes: 11 });
});
it("saves a full pair as posted, clamped", async () => {
  expect((await post({ ticket_warn_minutes: 12, ticket_late_minutes: 30 })).status).toBe(200);
  expect(state.written).toMatchObject({ ticket_warn_minutes: 12, ticket_late_minutes: 30 });
});
