import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "@/lib/types";
import type { ReadyTable } from "@/lib/ready-tables";

const state = vi.hoisted(() => ({ orders: [] as Order[], toast: vi.fn() }));

// Drive the handover without mounting a socket. State and notifications are
// the observable result: a refused handover must still be ready to collect.
vi.mock("react", () => ({
  useEffect: vi.fn(),
  useState: (initial: Order[]) => {
    state.orders = initial;
    return [initial, (next: (previous: Order[]) => Order[]) => {
      state.orders = next(state.orders);
    }];
  },
}));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => state.toast }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { useCounterPickup } from "@/hooks/useCounterPickup";

const order = (id: string): Order => ({
  id, restaurant_id: "restaurant", table_id: null, table_label: null,
  status: "ready", subtotal: 10, service_fee: 0, tip: 0, tax_pct: 0,
  total: 10, currency: "MXN", items: [], note: null, pay_method: "cash",
  paid: true, stripe_payment_intent: null, stripe_refund_id: null,
  created_at: "2026-10-14T15:00:00Z",
});
const pickup = (ids: string[]): ReadyTable => ({
  key: "pickup", label: null, code: "ORD-TEST", customerName: null,
  orderIds: ids, dishes: ids.length, since: "2026-10-14T15:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("handing a counter order over", () => {
  it("removes a pickup and reports delivery only after the server accepts it", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", send);
    const { handOver } = useCounterPickup("restaurant", [order("one"), order("two")]);
    await handOver(pickup(["one"]));
    expect(state.orders.map(o => o.id)).toEqual(["two"]);
    expect(state.toast).toHaveBeenCalledExactlyOnceWith("pos.pickedUp");
    expect(JSON.parse(send.mock.calls[0][1].body)).toEqual({
      id: "one", status: "completed", from: "ready",
    });
  });

  it.each(["refused", "offline"])("keeps a pickup visible when %s and never reports delivery", async mode => {
    const send = mode === "refused"
      ? vi.fn().mockResolvedValue({ ok: false })
      : vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", send);
    const { handOver } = useCounterPickup("restaurant", [order("one")]);
    await handOver(pickup(["one"]));
    expect(state.orders.map(o => o.id)).toEqual(["one"]);
    expect(state.toast).toHaveBeenCalledExactlyOnceWith("pos.pickupFailed", "error");
  });

  it("keeps only the refused orders when part of a handover succeeds", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: false }));
    const { handOver } = useCounterPickup("restaurant", [order("one"), order("two")]);
    await handOver(pickup(["one", "two"]));
    expect(state.orders.map(o => o.id)).toEqual(["two"]);
    expect(state.toast).toHaveBeenCalledExactlyOnceWith("pos.pickupFailed", "error");
  });
});
