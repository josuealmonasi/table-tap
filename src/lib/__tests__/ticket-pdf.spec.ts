import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { planColumns, ticketPdf, wrapToWidth, type TicketText } from "@/lib/ticket-pdf";
import { printable } from "@/lib/ticket-fonts";
import { TICKET_FONTS } from "@/lib/ticket-font-ids";
import type { ReceiptModel } from "@/lib/receipt";

const model: ReceiptModel = {
  code: "ORD-5C9D", when: "11 nov 2026, 15:25", tableLabel: "4", cur: "MXN", payMethod: "cash",
  lines: [
    { label: "2× Tonkotsu Ramen", qty: 2, name: "Tonkotsu Ramen", unit: 195, amount: 390 },
    { label: "1× Chocolate Lava Cake con helado de vainilla", qty: 1, name: "Chocolate Lava Cake con helado de vainilla", unit: 105, amount: 105 },
    { label: "3× Green Tea", qty: 3, name: "Green Tea", unit: 45, amount: 135 },
  ],
  rows: [["Propina", "MX$63.00"]], totalLabel: "Total", paid: 693,
};
const text: TicketText = {
  folio: "Folio", table: l => `Mesa ${l}`, header: { qty: "CANT", item: "DESCRIPCIÓN", price: "PRECIO", amount: "IMPORTE" },
  articles: n => `No. de artículos: ${n}`, payMethod: m => `Pagado en ${m === "cash" ? "efectivo" : "tarjeta"}`,
  loyaltyTitle: "TARJETA DE VISITAS", loyaltyLine: l => `Tarjeta ···· ${l.last4}: ${l.progress} de ${l.goal}`,
  qrHint: "Muestra este código en caja para encontrar tu ticket", thanks: "Gracias por su visita",
  notFiscal: "Este ticket no es una factura.",
};

const place = {
  name: "Demo Bistro", legalName: "Demo Bistro S.A. de C.V.", rfc: "DBI010101AB1",
  regime: "601 General de Ley Personas Morales",
  addressLines: ["Av. Los Pinos 245, Int. 3", "Col. Centro, C.P. 44100", "Guadalajara, Jalisco"], phone: "(33) 2456 7890",
};
const card = { last4: "K7P2", progress: 5, goal: 8, message: "Te faltan 3 para Postre gratis" };
/** 4 points a character: enough to test the arithmetic without a font. */
const measure = (s: string) => s.length * 4;

it("wraps by the font's own measure and cuts a word longer than the line", () => {
  expect(wrapToWidth("Chocolate Lava Cake con helado", 60, measure)).toEqual(["Chocolate Lava", "Cake con helado"]);
  expect(wrapToWidth("Supercalifragilistico", 40, measure)).toEqual(["Supercalif", "ragilistic", "o"]);
});

it("sizes the columns to what this ticket prints, and gives big amounts their own row (Codex review)", () => {
  const normal = planColumns(model, text.header, measure);
  expect(normal.ownLine).toBe(false);
  expect(normal.amount).toBe(measure("MX$390.00"));
  const big: ReceiptModel = { ...model, lines: [{ label: "", qty: 2, name: "Barra libre para evento privado", unit: 10000, amount: 20000 }] };
  const wide = planColumns(big, text.header, s => s.length * 6);
  expect(wide.ownLine).toBe(true);
  expect(wide.qty + wide.name).toBeLessThanOrEqual(226.77 - 24);
});

it("prints what each face can draw", () => {
  expect(printable("Piña colada 🍍 jalapeño −MX$5.00")).toBe("Piña colada jalapeño −MX$5.00");
  expect(printable("Descuento −MX$5.00 “especial”", true)).toBe('Descuento -MX$5.00 "especial"');
  expect(printable("Ñandú ☕", true)).toBe("Ñandú");
});

it.each(TICKET_FONTS)("renders a ticket-shaped PDF in %s, cut to its own length", async font => {
  const pdf = await ticketPdf(model, place, text, card, "https://table-tap-star.vercel.app/dashboard/bills?order=x", font);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  if (process.env.TICKET_SAMPLE_DIR) writeFileSync(`${process.env.TICKET_SAMPLE_DIR}/ticket-${font}.pdf`, pdf);
});

it("renders without a visit card or fiscal data", async () => {
  const pdf = await ticketPdf(model, { name: "Café" }, text, null, "https://x.test/");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
});
