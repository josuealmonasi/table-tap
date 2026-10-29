import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const state = vi.hoisted(() => ({
  events: [] as string[], member: false, insertError: false, inviteError: false, throwInvite: false,
  create: vi.fn(), invite: vi.fn(), remove: vi.fn(),
}));
vi.mock("@/lib/api-guard", () => ({ actingOwner: async () => ({ restaurantId: "r1", email: "owner@test.com" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, seatBlocks: async () => null }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }), allPlans: async () => [] }));
vi.mock("@/lib/user-log", () => ({ logUserChange: async () => {} }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  auth: { admin: { createUser: state.create, inviteUserByEmail: state.invite, deleteUser: state.remove } },
  from: () => {
    const q = { select: () => q, eq: () => q,
      delete: () => { state.member = false; state.events.push("free-seat"); return q; },
      then: (resolve: (v: unknown) => void) => Promise.resolve({ count: 0, error: null }).then(resolve),
      insert: async () => {
        state.events.push("membership");
        state.member = !state.insertError;
        return { error: state.insertError ? { message: "insert failed" } : null };
      },
    };
    return q;
  },
}) }));
import { POST } from "@/app/api/staff/route";
const post = () => POST(new NextRequest("https://test/api/staff", {
  method: "POST", body: JSON.stringify({ email: "waiter@test.com", role: "waiter" }),
}));
beforeEach(() => {
  vi.clearAllMocks(); state.events = []; state.member = false;
  state.insertError = false; state.inviteError = false; state.throwInvite = false;
  state.create.mockImplementation(async () => {
    state.events.push("create"); return { data: { user: { id: "new-user" } }, error: null };
  });
  state.invite.mockImplementation(async () => {
    state.events.push("invite");
    expect(state.member).toBe(true);
    if (state.throwInvite) throw new Error("mailer unavailable");
    return { data: { user: { id: "new-user" } }, error: state.inviteError ? { message: "mailer unavailable" } : null };
  });
  state.remove.mockImplementation(async () => {
    state.events.push("cleanup"); state.member = false; return { error: null };
  });
});
it("commits the membership before sending its invite", async () => {
  expect((await post()).status).toBe(200);
  expect(state.events).toEqual(["create", "membership", "invite"]);
  expect(state.remove).not.toHaveBeenCalled();
});
it.each([false, true])("frees the membership when sending fails (throws: %s)", async throws => {
  state.inviteError = true; state.throwInvite = throws;
  expect((await post()).status).toBe(400);
  expect(state.member).toBe(false);
  expect(state.remove).toHaveBeenCalledExactlyOnceWith("new-user");
});
it("sends nothing if the membership cannot commit", async () => {
  state.insertError = true;
  expect((await post()).status).toBe(500);
  expect(state.invite).not.toHaveBeenCalled();
  expect(state.member).toBe(false);
});
it("never deletes an existing login when creation is refused", async () => {
  state.create.mockResolvedValue({ data: { user: null }, error: { message: "already exists" } });
  expect((await post()).status).toBe(400);
  expect(state.remove).not.toHaveBeenCalled();
  expect(state.invite).not.toHaveBeenCalled();
});

it("returns the seat even when Auth cleanup fails", async () => {
  state.inviteError = true;
  state.remove.mockResolvedValue({ error: { message: "Auth unavailable" } });
  expect((await post()).status).toBe(400);
  expect(state.member).toBe(false);
  expect(state.events).toContain("free-seat");
});
