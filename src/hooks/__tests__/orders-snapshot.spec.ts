import { beforeEach, expect, it, vi } from "vitest";
import type { BoardOrder } from "@/lib/kitchen-ticket";

// State that survives renders, so a second render sees what the first set.
const slots: unknown[] = [];
let cursor = 0;
vi.mock("react", () => ({
  useEffect: vi.fn(),
  useCallback: (fn: unknown) => fn,
  useState: <T,>(initial: T) => {
    const i = cursor++;
    if (!(i in slots)) slots[i] = initial;
    return [slots[i] as T, (value: T) => { slots[i] = value; }];
  },
}));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: true, markOffline: vi.fn() }) }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
const { useRestaurantOrders } = await import("@/hooks/useRestaurantOrders");
const render = (initial: BoardOrder[]) => { cursor = 0; return useRestaurantOrders("r1", initial); };
beforeEach(() => { slots.length = 0; vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }); });

it("audit M, 2: a refreshed snapshot replaces the list, so a completed order is not counted twice", () => {
  // The page's base counts the completed MX$100 once the refresh drops it from
  // the board; the list must drop it too, or today's takings read MX$200.
  const completed = { id: "o1", status: "completed", paid: true, total: 100 } as unknown as BoardOrder;
  const first = [completed];
  render(first);
  expect(render(first).orders).toEqual([completed]);
  const refreshed: BoardOrder[] = [];
  render(refreshed);
  expect(render(refreshed).orders).toEqual([]);
});
