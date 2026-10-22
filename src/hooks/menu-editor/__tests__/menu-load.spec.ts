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
  expect(Editor().loading).toBe(false);
  expect(Editor().loadFailed).toBe(true);
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
  expect(Editor().loading).toBe(false);
  expect(Editor().loadFailed).toBe(true);
  await expect(editor.updateProduct("dish", { description: "New" })).rejects.toThrow();
  expect(state.from).not.toHaveBeenCalled();
});
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
it("a reload after a save keeps the menu on screen, and an edit made meanwhile waits for it", async () => {
  // Every save reloads. Showing skeletons for each one blanked the editor
  // after every edit, and the shorter page threw the owner back to the top.
  // With the menu left on screen, a click during the read must not vanish.
  const editor = Editor();
  await editor.reload();
  expect(Editor().loading).toBe(false);
  let finish!: (data: MenuData) => void;
  state.read.mockImplementationOnce(() => new Promise<MenuData>(resolve => { finish = resolve; }));
  const again = editor.reload();
  expect(Editor().loading).toBe(false);
  const edit = editor.setAvailability("dish", false);
  await settle();
  expect(state.sent).not.toHaveBeenCalled();
  finish(menu);
  await Promise.all([again, edit]);
  expect(state.sent).toHaveBeenCalledTimes(1);
  expect(Editor().loading).toBe(false);
});
it("J17: an edit waiting on a read that fails is never sent", async () => {
  const editor = Editor();
  await editor.reload();
  let fail!: (error: Error) => void;
  state.read.mockImplementationOnce(() => new Promise<MenuData>((_, reject) => { fail = reject; }));
  const again = editor.reload();
  const edit = editor.setAvailability("dish", false);
  fail(new Error("read failed"));
  await Promise.all([again, edit]);
  expect(state.sent).not.toHaveBeenCalled();
  expect(Editor().loading).toBe(false);
  expect(Editor().loadFailed).toBe(true);
});
it("J17: an edit waits for the newest read, not the one it found running", async () => {
  const editor = Editor();
  await editor.reload();
  const finish: ((data: MenuData) => void)[] = [];
  state.read.mockImplementation(() => new Promise<MenuData>(resolve => { finish.push(resolve); }));
  const first = editor.reload();
  const edit = editor.setAvailability("dish", false);
  const second = editor.reload();
  finish[0](menu);
  await first;
  await settle();
  expect(state.sent).not.toHaveBeenCalled();
  finish[1](menu);
  await Promise.all([second, edit]);
  expect(state.sent).toHaveBeenCalledTimes(1);
});
it("J17: menu names and availability cannot write before the full read", async () => {
  const editor = Editor();
  await editor.renameMenu("menu", "New name");
  await editor.setMenuActive("menu", true);
  await editor.setAvailability("dish", true);
  expect(state.sent).not.toHaveBeenCalled();
});
