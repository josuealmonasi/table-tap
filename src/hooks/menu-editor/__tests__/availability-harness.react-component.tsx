import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";
import type { MenuItem } from "@/lib/types";
import type { MenuData } from "@/lib/menu-data";

const state = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), toast: vi.fn(), from: vi.fn(), inserted: [] as unknown[],
  t: (key: string) => key,
  rows: [] as MenuItem[],
  sent: [] as { id: string; available: boolean; filters: unknown[][]; select: string }[],
}));
export const mocks = state;
const client = { from: state.from };
vi.mock("@/lib/supabase/client", () => ({ createClient: () => client }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => mocks.t }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => mocks.toast }));
vi.mock("@/lib/menu-data", async original => ({ ...await original<typeof import("@/lib/menu-data")>(), fetchMenuData: state.read }));
import { useMenuEditor } from "@/hooks/useMenuEditor";

export interface Result { data: MenuItem[] | null; error: { message: string } | null }
export function dish(id = "dish", changes: Partial<MenuItem> = {}): MenuItem {
  return { id, restaurant_id: "r1", menu_id: "m1", category_id: null, is_addon: false,
    name: id, description: "", price: 20, emoji: "", image_url: null, popular: false,
    available: true, modifiers: [], dietary: [], discount_pct: 0, skips_kitchen: false,
    sort_order: 0, stock: null, ...changes };
}
export function snapshot(): MenuData {
  return { menus: [], sections: [], links: {},
    products: mocks.rows.filter(row => !row.is_addon), addons: mocks.rows.filter(row => row.is_addon) };
}
export function reset(): void {
  vi.clearAllMocks(); mocks.sent = []; mocks.inserted = []; mocks.rows = [dish(), dish("extra", { is_addon: true })];
  mocks.read.mockReset().mockImplementation(async () => snapshot());
  mocks.write.mockReset().mockImplementation(async (id: string, available: boolean) => ({
    data: [dish(id, { ...mocks.rows.find(row => row.id === id), available })], error: null,
  }));
  mocks.from.mockImplementation(() => {
    const filters: unknown[][] = []; let available = true; let select = "";
    const query = {
      update: (input: { available: boolean }) => { available = input.available; return query; },
      eq: (...filter: unknown[]) => { filters.push(filter); return query; },
      select: (columns: string) => { select = columns; return query; },
      insert: (row: unknown) => { mocks.inserted.push(row); return query; },
      single: async () => ({ data: { id: "copy" }, error: null }),
      then: (resolve: (result: unknown) => unknown, reject: (error: unknown) => unknown) => {
        const id = filters.find(([key]) => key === "id")?.[1] as string;
        mocks.sent.push({ id, available, filters, select });
        return Promise.resolve(mocks.write(id, available)).then((result: Result) => {
          if (!result.error && result.data?.length === 1) {
            const row = result.data[0]; mocks.rows = mocks.rows.map(old => old.id === row.id ? row : old);
          }
          return { ...result, data: select === "id" ? result.data?.map(row => ({ id: row.id })) : result.data };
        }).then(resolve, reject);
      },
    };
    return query;
  });
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}
export async function mount(restaurantId = "r1") {
  let editor!: ReturnType<typeof useMenuEditor>;
  function Probe({ restaurantId }: { restaurantId: string }) { editor = useMenuEditor(restaurantId); return null; }
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); let closed = false;
  const render = async (restaurantId: string) => { await act(async () => root.render(<Probe restaurantId={restaurantId} />)); };
  await render(restaurantId);
  return { get editor() { return editor; }, render,
    close: async () => { if (closed) return; closed = true; await act(async () => root.unmount()); container.remove(); } };
}
export type Harness = Awaited<ReturnType<typeof mount>>;
export async function begin(h: Harness, id = "dish", available = false) {
  let done!: Promise<void>;
  await act(async () => { done = h.editor.setAvailability(id, available); });
  return { done };
}
export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
