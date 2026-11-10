import { beforeEach, describe, expect, it, vi } from "vitest";

const actingManager = vi.fn();
const invalidatePublicMenu = vi.fn();
vi.mock("@/lib/api-guard", () => ({ actingManager: () => actingManager() }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: (id: string) => invalidatePublicMenu(id) }));
vi.mock("@/lib/api-error", () => ({
  apiError: async (key: string, status: number) => new Response(JSON.stringify({ error: key }), { status }),
}));

import { POST } from "../route";

describe("POST /api/menu/refresh", () => {
  beforeEach(() => { actingManager.mockReset(); invalidatePublicMenu.mockReset(); });

  it("clears only the caller's own restaurant", async () => {
    actingManager.mockResolvedValue({ restaurantId: "r1", role: "manager" });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(invalidatePublicMenu).toHaveBeenCalledWith("r1");
  });

  it("refuses anyone who may not edit the menu, and clears nothing", async () => {
    actingManager.mockResolvedValue(null);
    const res = await POST();
    expect(res.status).toBe(403);
    expect(invalidatePublicMenu).not.toHaveBeenCalled();
  });
});
