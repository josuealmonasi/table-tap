import { beforeEach, describe, expect, it, vi } from "vitest";
const post = vi.fn();
vi.mock("react", () => ({
  useState: <T,>(initial: T) => [initial, vi.fn()],
  useEffect: vi.fn(), useCallback: <T,>(fn: T) => fn,
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/hooks/useBadges", () => ({ badgesChanged: vi.fn() }));
vi.mock("@/hooks/useOnline", () => ({ useOnline: () => ({ online: true, markOffline: vi.fn() }) }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
const { useRestaurantOrders } = await import("@/hooks/useRestaurantOrders");
beforeEach(() => { vi.stubGlobal("fetch", post); post.mockReset(); });
describe("a stale cancellation offer", () => {
  it("tells the dialog to re-read after a 409 instead of reusing the unpaid offer", async () => {
    post.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "changed" }) });
    const orders = useRestaurantOrders("r1", []);
    expect(await orders.cancelOrder("o1")).toEqual({ error: "changed", stale: true });
  });
  it("does not reopen the offer after a network or server failure", async () => {
    post.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "try again" }) });
    expect(await useRestaurantOrders("r1", []).cancelOrder("o1")).toEqual({ error: "try again", stale: false });
  });
});
