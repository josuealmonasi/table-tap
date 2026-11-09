import { expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const s = vi.hoisted(() => ({ rpc: vi.fn(), sourceLines: [] as unknown[] }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ restaurantId: "r1", email: "manager@x" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => NextResponse.json({ error }, { status }) }));
vi.mock("@/lib/costs/guard", async original => ({ ...await original<typeof import("@/lib/costs/guard")>(), costsBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: s.rpc, from: (table: string) => {
  const q: Record<string, unknown> = {};
  for (const k of ["select", "eq", "limit"]) q[k] = () => q;
  q.maybeSingle = async () => ({ data: { name: "Latte copy", modifiers: [{ label: "Milk", type: "single", options: ["Whole", "Oat"] }] }, error: null });
  q.then = (done: (v: unknown) => unknown) => Promise.resolve({ data: table === "recipe_lines" ? s.sourceLines : [], error: null }).then(done);
  return q;
} }) }));
const { PUT } = await import("@/app/api/costs/recipe/route");
const ING = "00000000-0000-4000-8000-0000000000a1";
const send = (body: object) => PUT(new NextRequest("https://test/api/costs/recipe", { method: "PUT", body: JSON.stringify(body) }));

it("a copied product takes its source's recipe, checked like any other (D5)", async () => {
  s.sourceLines = [{ ingredient_id: ING, quantity: 200, mod_label: "Milk", mod_option: "Oat" }];
  s.rpc.mockResolvedValue({ data: 1, error: null });
  const res = await send({ itemId: "00000000-0000-4000-8000-0000000000b2", lines: [], copyFrom: "00000000-0000-4000-8000-0000000000b1" });
  expect(res.status).toBe(200);
  expect(s.rpc).toHaveBeenCalledWith("replace_recipe", expect.objectContaining({
    p_item: "00000000-0000-4000-8000-0000000000b2",
    p_lines: [{ ingredient_id: ING, quantity: 200, mod_label: "Milk", mod_option: "Oat" }],
  }));
});
