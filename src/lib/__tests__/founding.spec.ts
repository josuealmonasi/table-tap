import { describe, expect, it } from "vitest";
import { FOUNDING_SLOTS, foundingOpen, slotsLeft, yearlySaving } from "@/lib/founding";

describe("el precio de fundador", () => {
  it("cuenta los lugares que quedan", () => {
    expect(slotsLeft(0)).toBe(FOUNDING_SLOTS);
    expect(slotsLeft(49)).toBe(1);
    expect(slotsLeft(50)).toBe(0);
  });

  it("nunca reporta lugares negativos", () => {
    // Si alguna vez se otorgan de más, la pantalla dice "cero", no "-3".
    expect(slotsLeft(60)).toBe(0);
    expect(foundingOpen(60)).toBe(false);
  });

  it("cierra exactamente al llenarse", () => {
    expect(foundingOpen(49)).toBe(true);
    expect(foundingOpen(50)).toBe(false);
  });

  it("calcula lo que no sube al año", () => {
    // 899 - 699 = 200 al mes que el fundador no paga nunca.
    expect(yearlySaving(699, 899)).toBe(2400);
    expect(yearlySaving(1499, 1899)).toBe(4800);
  });

  it("no inventa ahorro cuando no hay precio de lista", () => {
    expect(yearlySaving(699, null)).toBe(0);
    expect(yearlySaving(699, undefined)).toBe(0);
    // Ni cuando el de lista es menor: eso sería un descuento al revés.
    expect(yearlySaving(899, 699)).toBe(0);
  });
});
