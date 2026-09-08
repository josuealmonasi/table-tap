import { describe, expect, it } from "vitest";
import {
  currentPrice,
  FOUNDING_SLOTS,
  foundingOpen,
  slotsLeft,
  yearlySaving,
} from "@/lib/founding";

describe("the founding price", () => {
  it("counts the places still open", () => {
    expect(slotsLeft(0)).toBe(FOUNDING_SLOTS);
    expect(slotsLeft(49)).toBe(1);
    expect(slotsLeft(50)).toBe(0);
  });

  it("never reports a negative number of places", () => {
    // If more are ever granted than exist, the screen says "zero", not "-3".
    expect(slotsLeft(60)).toBe(0);
    expect(foundingOpen(60)).toBe(false);
  });

  it("closes on the place that fills it, not the one after", () => {
    expect(foundingOpen(49)).toBe(true);
    expect(foundingOpen(50)).toBe(false);
  });

  it("works out what a year at this price never costs them", () => {
    // 899 - 699 = 200 a month the founder never pays.
    expect(yearlySaving(699, 899)).toBe(2400);
    expect(yearlySaving(1499, 1899)).toBe(4800);
  });

  it("charges the founding price while places remain", () => {
    const servicio = { monthly_price: 699, list_price: 899 };
    expect(currentPrice(servicio, 0)).toBe(699);
    expect(currentPrice(servicio, 49)).toBe(699);
  });

  it("rises on its own the moment the last place goes", () => {
    // Nobody has to remember to edit the plans table: number 51 sees 899.
    const servicio = { monthly_price: 699, list_price: 899 };
    const casa = { monthly_price: 1499, list_price: 1899 };
    expect(currentPrice(servicio, 50)).toBe(899);
    expect(currentPrice(casa, 50)).toBe(1899);
    expect(currentPrice(servicio, 120)).toBe(899);
  });

  it("falls again if more places are opened", () => {
    // Computed, not stored: moving FOUNDING_SLOTS is reversible.
    const servicio = { monthly_price: 699, list_price: 899 };
    expect(currentPrice(servicio, FOUNDING_SLOTS - 1)).toBe(699);
  });

  it("stays put on a plan with no list price to rise to", () => {
    // Grupo is quoted by hand; there is no list price to rise to.
    expect(currentPrice({ monthly_price: 3499, list_price: null }, 999)).toBe(3499);
  });

  it("invents no saving when there is no list price", () => {
    expect(yearlySaving(699, null)).toBe(0);
    expect(yearlySaving(699, undefined)).toBe(0);
    // Nor when the list price is lower: that would be a discount in reverse.
    expect(yearlySaving(899, 699)).toBe(0);
  });
});
