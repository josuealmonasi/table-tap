import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mock = vi.hoisted(() => ({ create: vi.fn(), resend: vi.fn(), remove: vi.fn(), insert: vi.fn(), limited: false }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/rate-limit", () => ({ clientKey: () => "ip", isRateLimited: async () => mock.limited }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  auth: { admin: { createUser: mock.create, deleteUser: mock.remove }, resend: mock.resend },
  from: () => ({ insert: mock.insert }),
}) }));
import { POST } from "@/app/api/signup/route";
const request = () => new NextRequest("https://app.tabletap.mx/api/signup", { method: "POST", headers: { Origin: "https://evil.example" },
  body: JSON.stringify({ restaurantName: "Cafe", email: "owner@example.com", password: "Password123!", acceptedTerms: true }) });
beforeEach(() => {
  vi.clearAllMocks(); mock.limited = false;
  mock.create.mockResolvedValue({ data: { user: { id: "owner" } }, error: null });
  mock.insert.mockResolvedValue({ error: null }); mock.resend.mockResolvedValue({ error: null });
});
it("E4: owner signup leaves email unconfirmed and returns a pending verification state", async () => {
  const res = await POST(request());
  expect(res.status).toBe(200);
  expect(mock.create).toHaveBeenCalledWith(expect.objectContaining({ email_confirm: false }));
  expect(await res.json()).toMatchObject({ pendingVerification: true });
});
it("E4: sends a verification link to the app's completion path, never the supplied Origin", async () => {
  await POST(request());
  expect(mock.resend).toHaveBeenCalledWith({ type: "signup", email: "owner@example.com",
    options: { emailRedirectTo: "https://app.tabletap.mx/auth/callback?next=/signup/complete" } });
  expect(mock.insert).toHaveBeenCalledWith(expect.objectContaining({ owner_signup_pending: true, plan: "servicio", plan_status: "trialing" }));
});
it("E4: a failed confirmation send keeps the account pending so resend can recover", async () => {
  mock.resend.mockResolvedValue({ error: { message: "mail unavailable" } });
  expect(await (await POST(request())).json()).toMatchObject({ pendingVerification: true, verificationSent: false });
  expect(mock.remove).not.toHaveBeenCalled();
});
