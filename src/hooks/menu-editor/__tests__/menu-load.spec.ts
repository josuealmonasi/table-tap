import { beforeEach, expect, it, vi } from "vitest";
import type { MenuData } from "@/lib/menu-data";

const state = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], values: [] as unknown[], cursor: 0, refCursor: 0,
  read: vi.fn(), from: vi.fn(), sent: vi.fn(), toast: vi.fn(),
}));
vi.mock("react", () => ({
  useCallback: (fn: unknown) => fn, useEffect: () => {},
  useRef: (initial: unknown) => state.refs[state.refCursor++] ??= { current: initial },
  useState: (initial: unknown) => {
    const slot = state.cursor++;
    if (!(slot in state.values)) state.values[slot] = initial;
    return [state.values[slot], (value: unknown) => { state.values[slot] = value; }];
  },
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ from: state.from }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/lib/menu-data", () => ({ fetchMenuData: state.read }));
const { useMenuEditor } = await import("../../useMenuEditor");
const menu: MenuData = { menus: [], sections: [], products: [], addons: [], links: {} };
function Editor() {
  state.cursor = 0; state.refCursor = 0;
  return useMenuEditor("restaurant");
}
beforeEach(() => {
  vi.clearAllMocks(); state.refs = []; state.values = [];
  state.read.mockReset().mockResolvedValue(menu);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const query = {
    update: () => query, delete: () => query, eq: () => query,
    then: (resolve: (value: unknown) => unknown) => {
      state.sent(); return Promise.resolve({ error: null }).then(resolve);
    },
  };
  state.from.mockReturnValue(query);
});
it("J17: a failed reload cannot let a pending save replace extras", async () => {
  const editor = Editor();
  state.read.mockResolvedValueOnce(menu);
  await editor.reload();
  state.read.mockRejectedValueOnce(new Error("read failed"));
  await editor.reload();
  await expect(editor.setProductAddons("dish", [])).rejects.toThrow("Menu has not loaded");
  expect(state.from).not.toHaveBeenCalled();
  expect(Editor().loading).toBe(true);
  expect(state.toast).toHaveBeenCalledWith("menu.loadFailed", "error");
});
it("J17: an older read cannot unlock editing after the latest read fails", async () => {
  const editor = Editor();
  let finish!: (data: MenuData) => void;
  state.read.mockImplementationOnce(() => new Promise<MenuData>(resolve => { finish = resolve; }));
  const oldRead = editor.reload();
  state.read.mockRejectedValueOnce(new Error("read failed"));
  await editor.reload();
  finish(menu);
  await oldRead;
  expect(Editor().loading).toBe(true);
  await expect(editor.updateProduct("dish", { description: "New" })).rejects.toThrow();
  expect(state.from).not.toHaveBeenCalled();
});
it("J17: menu names and availability cannot write before the full read", async () => {
  const editor = Editor();
  await editor.renameMenu("menu", "New name");
  await editor.setMenuActive("menu", true);
  await editor.setAvailability("dish", true);
  expect(state.sent).not.toHaveBeenCalled();
});
