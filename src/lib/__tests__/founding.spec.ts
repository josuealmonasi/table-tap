import { describe, expect, it } from "vitest";
import {
  currentPrice,
  FOUNDING_SLOTS,
  foundingOpen,
  slotsLeft,
  yearlySaving,
} from "@/lib/founding";

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

  it("cobra el precio de fundador mientras queden lugares", () => {
    const servicio = { monthly_price: 699, list_price: 899 };
    expect(currentPrice(servicio, 0)).toBe(699);
    expect(currentPrice(servicio, 49)).toBe(699);
  });

  it("sube solo en cuanto se llena el lugar 50", () => {
    // Nadie tiene que acordarse de editar la tabla de planes: el 51 ve 899.
    const servicio = { monthly_price: 699, list_price: 899 };
    const casa = { monthly_price: 1499, list_price: 1899 };
    expect(currentPrice(servicio, 50)).toBe(899);
    expect(currentPrice(casa, 50)).toBe(1899);
    expect(currentPrice(servicio, 120)).toBe(899);
  });

  it("vuelve a bajar si se abren más lugares", () => {
    // Se calcula, no se guarda: mover FOUNDING_SLOTS es reversible.
    const servicio = { monthly_price: 699, list_price: 899 };
    expect(currentPrice(servicio, FOUNDING_SLOTS - 1)).toBe(699);
  });

  it("se queda en su precio si el plan no tiene lista", () => {
    // Grupo se cotiza a mano; no hay precio de lista al que subir.
    expect(currentPrice({ monthly_price: 3499, list_price: null }, 999)).toBe(3499);
  });

  it("no inventa ahorro cuando no hay precio de lista", () => {
    expect(yearlySaving(699, null)).toBe(0);
    expect(yearlySaving(699, undefined)).toBe(0);
    // Ni cuando el de lista es menor: eso sería un descuento al revés.
    expect(yearlySaving(899, 699)).toBe(0);
  });
});
