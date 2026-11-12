import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const f = vi.hoisted(() => ({ enabled: true, id: "server-card" as string | null, lookup: vi.fn() }));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => ({ limits: {} }) }));
vi.mock("@/lib/loyalty/server", () => ({ loyaltyOn: async () => f.enabled }));
vi.mock("@/lib/loyalty/attachment-server", () => ({ cardForSale: async (...args: unknown[]) => { f.lookup(...args); return f.id; } }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => "es" }));
import { saleCard } from "@/lib/loyalty/sale-card";
import { replayBody } from "@/lib/offline-sales";
beforeEach(() => { f.enabled = true; f.id = "server-card"; vi.clearAllMocks(); });
it("resolves the normalized code within the actor's restaurant", async () => {
  expect(await saleCard("r1", "k7qm-3xw9-k7p2")).toEqual({ cardId: "server-card" });
  expect(f.lookup).toHaveBeenCalledWith("r1", "K7QM3XW9K7P2");
});
it("no card adds no query or condition to an existing sale", async () => {
  expect(await saleCard("r1", undefined)).toEqual({ cardId: null }); expect(f.lookup).not.toHaveBeenCalled();
});
it.each([["bad", 400], [123, 400], [{ cardId: "client-card" }, 400]])("refuses a fabricated card identity %j", async (raw, status) => {
  expect((await saleCard("r1", raw)).error?.status).toBe(status); expect(f.lookup).not.toHaveBeenCalled();
});
it("refuses a new selection if the program or tier is off", async () => {
  f.enabled = false; expect((await saleCard("r1", "K7QM3XW9K7P2")).error?.status).toBe(409); expect(f.lookup).not.toHaveBeenCalled();
});
it("refuses an unknown card on a new sale", async () => {
  f.id = null; expect((await saleCard("r1", "K7QM3XW9K7P2")).error?.status).toBe(404);
});
it("replaying already collected money survives a switched-off or deleted card", async () => {
  f.enabled = false; expect(await saleCard("r1", "K7QM3XW9K7P2", true)).toEqual({ cardId: "server-card" });
  f.id = null; expect(await saleCard("r1", "K7QM3XW9K7P2", true)).toEqual({ cardId: null });
});
it("keeps the selected code in a held sale's immutable replay", () => {
  expect(replayBody({ loyaltyCode: "K7QM3XW9K7P2", posRef: "ref", restaurantId: "r", items: [], method: "cash", at: "now", charge: { subtotal: 10, serviceFee: 0, tip: 0, discount: 0, total: 10 } }).loyaltyCode).toBe("K7QM3XW9K7P2");
});
it("cash, card, account and replay transaction payloads carry the server-resolved id", () => {
  for (const file of ["src/app/api/pos/order/route.ts", "src/lib/pos-offline.ts"]) {
    const text = readFileSync(file, "utf8");
    expect(text).toContain("saleCard(actor.restaurantId, body.loyaltyCode"); expect(text).toContain("loyalty_card_id: loyalty.cardId");
  }
  expect(readFileSync("src/hooks/usePosCharge.ts", "utf8").match(/loyaltyCode: details.loyaltyCard\?\.code/g)).toHaveLength(2);
});
it("each receipt route uses the shared source and every bill host exposes the selector", () => {
  for (const file of ["src/app/api/receipt/route.ts", "src/app/api/orders/print/route.ts"]) {
    expect(readFileSync(file, "utf8")).toContain("readOrderReceipt");
  }
  expect(readFileSync("src/lib/pos-receipt.ts", "utf8")).toContain("withReceiptCards");
  for (const file of ["src/components/dashboard/pos/PosScreen.tsx", "src/components/dashboard/SettleTableDialog.tsx"]) {
    expect(readFileSync(file, "utf8")).toMatch(/loyalty && <AttachCard/);
  }
  expect(readFileSync("src/components/dashboard/BillsPanel.tsx", "utf8")).toContain("loyalty={loyalty}");
  expect(readFileSync("src/components/dashboard/waiter/TableOrderScreen.tsx", "utf8")).toContain("loyalty={loyalty}");
  expect(readFileSync("src/components/customer/BillSheet.tsx", "utf8")).toContain("open && sessionId && <DeviceBillCard");
});
