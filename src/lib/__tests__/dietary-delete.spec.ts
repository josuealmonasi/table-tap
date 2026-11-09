import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({ dietary: ["nuts"], fail: false }));
vi.mock("@/lib/desk-mutation", () => ({ deskMutation: (fn: (req: NextRequest, actor: { restaurantId: string }) => Promise<Response>) => (req: NextRequest) => fn(req, { restaurantId: "r1" }) }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status: number) => Response.json({ error }, { status }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  rpc: async (_name: string, args: { p_restaurant: string; p_tag: string }) => {
    expect(args).toEqual({ p_restaurant: "r1", p_tag: "tag1" });
    state.dietary.push("dairy");
    if (state.fail) return { error: { message: "failed" } };
    state.dietary = state.dietary.filter(key => key !== "nuts");
    return { data: { unlinked: 1 }, error: null };
  },
  from: (table: string) => {
    let patch: { dietary: string[] } | undefined;
    const query = {
      select: () => query, eq: () => query, delete: () => query,
      update: (value: { dietary: string[] }) => { patch = value; return query; },
      maybeSingle: async () => ({ data: { id: "tag1", key: "nuts" } }),
      contains: async () => {
        const data = [{ id: "dish", dietary: [...state.dietary] }];
        state.dietary.push("dairy");
        return { data };
      },
      then: (resolve: (value: { error: { message: string } | null; data: unknown }) => unknown) => {
        if (patch) state.dietary = patch.dietary;
        resolve({ error: state.fail ? { message: "failed" } : null, data: table === "dietary_tags" ? [] : null });
      },
    };
    return query;
  },
}) }));
import { DELETE } from "@/app/api/dietary-tags/route";
beforeEach(() => { state.dietary = ["nuts"]; state.fail = false; });
const request = () => new NextRequest("http://localhost/api/dietary-tags", { method: "DELETE", body: JSON.stringify({ id: "tag1" }) });
it("D1: deleting nuts preserves dairy added after the deletion starts", async () => {
  expect((await DELETE(request())).status).toBe(200);
  expect(state.dietary).toEqual(["dairy"]);
});
it("D1: a failed unlink reports failure and keeps the tag's warnings", async () => {
  state.fail = true;
  expect((await DELETE(request())).status).toBe(500);
  expect(state.dietary).toContain("nuts");
});
it("D1: SQL removes only the requested key from the current row in the tag transaction", () => {
  const sql = readFileSync("supabase/schema.sql", "utf8");
  const fn = sql.split("create or replace function public.delete_dietary_tag_v1")[1]?.split("$$;")[0] ?? "";
  expect(fn).toMatch(/for update/i);
  expect(fn).toMatch(/set dietary = array_remove\(dietary, v_key\)/i);
  expect(fn).toMatch(/delete from public.dietary_tags/);
  expect(sql).toContain("revoke all on function public.delete_dietary_tag_v1(uuid, uuid) from public, anon, authenticated");
});
