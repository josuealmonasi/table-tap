import { describe, expect, it } from "vitest";
import { offlineCharge, offlineDrift, offlineLines, OFFLINE_MAX_AGE_DAYS } from "@/lib/offline-sale";
import { replayBody, type HeldSale } from "@/lib/offline-sales";
import { offlineReceipt } from "@/lib/offline-receipt";

const NOW = Date.parse("2026-10-15T18:00:00Z");
const charge = (over: Record<string, unknown> = {}) => ({
  at: "2026-10-15T17:30:00Z", subtotal: 100, serviceFee: 10, tip: 5, discount: 0, total: 115, ...over,
});

describe("what an offline sale charged", () => {
  it("accepts a charge whose figures add up, at a time just past", () => {
    expect(offlineCharge(charge(), NOW)).toEqual({ ...charge(), at: "2026-10-15T17:30:00.000Z" });
  });

  it("refuses figures that do not add up", () => {
    expect(offlineCharge(charge({ total: 120 }), NOW)).toBeNull();
    expect(offlineCharge(charge({ tip: -5, total: 105 }), NOW)).toBeNull();
    expect(offlineCharge(charge({ subtotal: "lots" }), NOW)).toBeNull();
  });

  it("refuses a sale from the future, or from too long ago", () => {
    expect(offlineCharge(charge({ at: "2026-10-15T19:00:00Z" }), NOW)).toBeNull();
    // A device clock a minute ahead is a clock, not a sale from the future.
    expect(offlineCharge(charge({ at: "2026-10-15T18:01:00Z" }), NOW)).not.toBeNull();
    const old = new Date(NOW - (OFFLINE_MAX_AGE_DAYS + 1) * 86_400_000).toISOString();
    expect(offlineCharge(charge({ at: old }), NOW)).toBeNull();
    expect(offlineCharge(charge({ at: "yesterday" }), NOW)).toBeNull();
  });

  it("keeps a float the till added up, rounded to centavos", () => {
    expect(offlineCharge(charge({ subtotal: 3, serviceFee: 0.30000000000000004, tip: 0, total: 3.3 }), NOW)?.serviceFee).toBe(0.3);
  });
});

describe("the difference from today's menu", () => {
  it("is what was collected less what the menu prices it at", () => {
    expect(offlineDrift(115, 110)).toBe(5);
    expect(offlineDrift(100, 100)).toBe(0);
    expect(offlineDrift(115, null)).toBeNull();
  });
});

describe("the till's own lines, for a dish the menu no longer has", () => {
  it("keeps names and prices bounded, and drops what is not a line", () => {
    const lines = offlineLines([
      { itemId: "x", name: "Croissant de almendra", emoji: "🥐", price: 45, qty: 2, mods: { Tamaño: "Grande", Extras: ["Miel", 3] } },
      { itemId: "y", name: "x".repeat(200), price: -3, qty: 1 },
      { itemId: "z", qty: 0 },
      "nonsense",
    ]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ name: "Croissant de almendra", price: 45, qty: 2, mods: { Tamaño: "Grande", Extras: ["Miel"] } });
    expect(lines[1].name).toHaveLength(80);
    expect(lines[1].price).toBe(0);
  });
});

describe("what a held sale sends", () => {
  it("carries its reference, its time and what it charged, and asks for no receipt", () => {
    const sale: HeldSale = {
      posRef: "4f6c2a1e-0d3b-4c7a-9b8e-1a2b3c4d5e6f", restaurantId: "r", at: "2026-10-15T17:30:00.000Z",
      method: "card", items: [], terminalRef: "AUT 1", currency: "MXN",
      charge: { subtotal: 100, serviceFee: 10, tip: 5, discount: 0, total: 115 },
    };
    expect(replayBody(sale)).toMatchObject({
      posRef: sale.posRef, restaurantId: "r", method: "card", terminalRef: "AUT 1", currency: "MXN", noReceipt: true,
      offline: { at: sale.at, subtotal: 100, serviceFee: 10, tip: 5, discount: 0, total: 115 },
    });
  });
});

describe("the receipt printed offline", () => {
  it("carries the code the sale will have, from its reference", () => {
    const html = offlineReceipt(
      {
        posRef: "4f6c2a1e-0d3b-4c7a-9b8e-1a2b3c4d5e6f", at: "2026-10-15T17:30:00.000Z",
        lines: [{ itemId: "x", name: "Latte", emoji: "☕", price: 58, qty: 1, mods: {} }],
        charge: { subtotal: 58, serviceFee: 0, tip: 0, discount: 0, total: 58 }, method: "cash", currency: "MXN",
      },
      { name: "Café", timeZone: "America/Mexico_City", locale: "es-MX" },
      (key, vars) => `${key} ${JSON.stringify(vars ?? {})}`,
    );
    expect(html).toContain("Latte");
    expect(html).toContain("ORD-4F6C");
  });
});
