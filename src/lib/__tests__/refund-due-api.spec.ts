import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/refunds-due/route";
import { refundDue } from "@/lib/refund-due";
import { actingManager } from "@/lib/api-guard";

vi.mock("@/lib/api-guard", () => ({ actingManager: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));
vi.mock("@/lib/refund-due", () => ({ refundDue: vi.fn() }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
beforeEach(() => vi.clearAllMocks());
const request = () => new NextRequest("http://localhost/api/refunds-due", { method: "POST", body: JSON.stringify({ id: "due" }) });

it("returns a pending fee separately from a completed customer refund", async () => {
  vi.mocked(actingManager).mockResolvedValue({ restaurantId: "r1", email: "manager", role: "manager" });
  vi.mocked(refundDue).mockResolvedValue({ ok: true, amount: 125.5, alreadyInStripe: true, feePending: true });
  const response = await POST(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, alreadyInStripe: true, feePending: true });
  expect(refundDue).toHaveBeenCalledWith({ admin: true }, "r1", "due", "manager");
});

it("still refuses anyone who cannot manage the restaurant", async () => {
  vi.mocked(actingManager).mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect(refundDue).not.toHaveBeenCalled();
});
