import { beforeEach, expect, it, vi } from "vitest";
import { resetHooks, state } from "./s23-test-helpers";
const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), toast: vi.fn(), reload: vi.fn(), read: vi.fn() }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  ...await import("./s23-test-helpers").then(h => ({ useState: h.useState, useRef: h.useRef })),
  useCallback: (fn: unknown) => fn, useEffect: () => {},
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/menu-data", () => ({ fetchMenuData: mocks.read, reorderRows: vi.fn() }));
import { makeWriter } from "@/hooks/menu-editor/writer";
import { addonActions } from "@/hooks/menu-editor/addons";
import { useMenuEditor } from "@/hooks/useMenuEditor";
import { useCoupons } from "@/hooks/useCoupons";
import { useSplit } from "@/hooks/useSplit";
import type { EditorContext } from "@/hooks/menu-editor/types";
const menu = { menus: [{ id: "m", name: "Lunch" }], sections: [], products: [], addons: [], links: {} };
beforeEach(() => {
  state.values = []; state.refs = []; resetHooks(); vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn()); mocks.read.mockResolvedValue(menu);
});
it("K10: the menu writer reports a refused write as failure", async () => {
  const writer = makeWriter({ supabase: { from: mocks.from } as unknown as EditorContext["supabase"], toast: mocks.toast, t: k => k, reload: mocks.reload });
  expect(await writer.run("write.updateExtra", Promise.resolve({ error: { message: "refused" } }), "done.extraUpdated")).toBe(false);
  expect(mocks.toast).not.toHaveBeenCalledWith("done.extraUpdated");
});
it("K11: replacing extras uses one transaction and propagates its refusal", async () => {
  const query = { delete: () => query, eq: () => query, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: { message: "refused" } }).then(resolve) };
  mocks.from.mockReturnValue(query); mocks.rpc.mockResolvedValue({ error: { message: "refused" } });
  vi.mocked(fetch).mockResolvedValue(new Response("{}", { status: 503 }));
  const ctx = { ready: async () => true, restaurantId: "r", supabase: { from: mocks.from, rpc: mocks.rpc }, w: { reportError: () => false }, reload: mocks.reload } as unknown as EditorContext;
  await expect(addonActions(ctx).setProductAddons("dish", ["extra"])).rejects.toThrow();
  expect(mocks.from).not.toHaveBeenCalled();
  expect(fetch).toHaveBeenCalledWith("/api/products", expect.objectContaining({ method: "PATCH" }));
});
it("K12: failed reload retains the complete menu and exposes retry state", async () => {
  const editor = useMenuEditor("r"); await editor.reload();
  mocks.read.mockRejectedValueOnce(new Error("offline")); await editor.reload(); resetHooks();
  const again = useMenuEditor("r");
  expect(again.loading).toBe(false); expect(again.menus).toEqual(menu.menus);
  expect(again).toHaveProperty("loadFailed", true); expect(again.reload).toBeTypeOf("function");
  await expect(again.setProductAddons("dish", [])).rejects.toThrow();
});
it("K16: failed coupon reads retain the last list and expose a retry", async () => {
  const coupons = [{ id: "c", code: "ABCD-1234" }]; let failed = false;
  const query = { select: () => query, eq: () => query, order: async () => failed ? { data: null, error: { message: "offline" } } : { data: coupons, error: null } };
  mocks.from.mockReturnValue(query); vi.mocked(fetch).mockResolvedValue(new Response("{}"));
  const hook = useCoupons("r"); await hook.remove("unused"); resetHooks(); expect(useCoupons("r").coupons).toEqual(coupons);
  failed = true; await hook.remove("unused"); resetHooks(); const again = useCoupons("r");
  expect(again.coupons).toEqual(coupons); expect(again).toHaveProperty("loadFailed", true); expect(again).toHaveProperty("reload");
});
it.each(["refusal", "network"])("K18: split %s leaves a visible error and the last split", async kind => {
  state.values = [{ id: "s", status: "proposed" }, false, "d"];
  if (kind === "refusal") vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ error: "Try later" }), { status: 429 }));
  else vi.mocked(fetch).mockRejectedValue(new Error("offline"));
  await expect(useSplit("r", "t", "s", false).join()).resolves.toBeUndefined(); resetHooks();
  const again = useSplit("r", "t", "s", false);
  expect(again).toHaveProperty("error", kind === "refusal" ? "Try later" : "done.networkError");
  expect(again.split).toMatchObject({ id: "s" });
});
