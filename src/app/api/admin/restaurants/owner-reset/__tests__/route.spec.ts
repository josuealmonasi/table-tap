import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import type { AdminAuditContext } from "@/lib/admin-audit";

const { lookup } = vi.hoisted(() => ({
  lookup: vi.fn(() => ({ maybeSingle: async () => ({ data: null }) })),
}));

vi.mock("@/lib/admin-audit", () => ({
  auditedAdminAction: (
    _action: string,
    handle: (req: NextRequest, context: AdminAuditContext) => Promise<Response>,
  ) => async (req: NextRequest) => {
    const { id } = await req.json();
    return handle(req, { targetId: id });
  },
}));
vi.mock("@/lib/admin", () => ({ getPlatformAdmin: async () => ({ userId: "fixture-admin" }) }));
vi.mock("@/lib/api-error", () => ({
  apiError: async (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ select: () => ({ eq: lookup }) }) }),
}));

import { POST } from "../route";

it("looks up the restaurant identified by the audit wrapper", async () => {
  const id = "00000000-0000-4000-8000-000000000000";
  const request = new NextRequest("https://tabletap.shop/api/admin/restaurants/owner-reset", {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  const result = await POST(request);

  expect(lookup).toHaveBeenCalledWith("id", id);
  expect(result.status).toBe(404);
});
