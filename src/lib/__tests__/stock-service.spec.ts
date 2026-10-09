import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderLineItem } from "@/lib/types";

const rpc = vi.fn();
const getPlan = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock("@/lib/plan-server", () => ({ getPlan: (...args: unknown[]) => getPlan(...args) }));
vi.mock("@/lib/plan", () => ({ can: (limits: { inventory: boolean }) => limits.inventory }));
const { reserveStock, releaseStock } = await import("@/lib/stock-service");
const { legacyStockDemand } = await import("@/lib/legacy-stock");
const lines = [{ itemId: "dish", qty: 2, extras: [{ id: "extra" }] }] as OrderLineItem[];

beforeEach(() => {
  vi.resetAllMocks();
  rpc.mockResolvedValue({ data: { ok: true, low: [], short: [] }, error: null });
  getPlan.mockResolvedValue({ limits: { inventory: true } });
});

describe("durable stock reservations", () => {
  it("reserves aggregated quantities with an identity, then returns by identity without reading a plan", async () => {
    const held = await reserveStock("restaurant", lines, 10);
    expect(held.reservationId).toEqual(expect.any(String));
    expect(rpc).toHaveBeenCalledWith("reserve_stock", {
      p_restaurant: "restaurant", p_threshold: 10, p_reservation: held.reservationId,
      p_demand: [{ item_id: "dish", qty: 2 }, { item_id: "extra", qty: 2 }],
    });
    getPlan.mockRejectedValue(new Error("plan no longer available"));
    await releaseStock("restaurant", held.reservationId);
    expect(getPlan).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenLastCalledWith("release_stock_reservation", {
      p_restaurant: "restaurant", p_reservation: held.reservationId,
    });
  });
  it("surfaces a failed return with its recovery identity", async () => {
    rpc.mockResolvedValue({ error: { message: "offline" } });
    await expect(releaseStock("restaurant", "held-id")).rejects.toThrow("Stock release held-id failed: offline");
  });
  it("does not create a reservation when inventory is not in the plan", async () => {
    getPlan.mockResolvedValue({ limits: { inventory: false } });
    expect((await reserveStock("restaurant", lines, 10)).reservationId).toBeNull();
    await releaseStock("restaurant", null);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("never applies historical stock guesses to a new managed order", async () => {
    expect(await legacyStockDemand("restaurant", { stock_managed: true, items: lines })).toEqual([]);
    expect(getPlan).not.toHaveBeenCalled();
  });
  it("keeps the former calculation only for orders from an older deployment", async () => {
    expect(await legacyStockDemand("restaurant", { stock_managed: false, items: lines })).toEqual([
      { item_id: "dish", qty: 2 }, { item_id: "extra", qty: 2 },
    ]);
  });
});
