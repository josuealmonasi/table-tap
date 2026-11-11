import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { lineRows, ticketPdf, wrapTicket, type TicketText } from "@/lib/ticket-pdf";
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

it("lays the lines out in four columns that fit the 80 mm roll", () => {
  const rows = lineRows(model);
  expect(rows.every(r => r.length <= 46)).toBe(true);
  expect(rows[0]).toMatch(/^2 {3}Tonkotsu Ramen/);
  expect(rows.some(r => r.startsWith("    Cake con helado"))).toBe(true);
  expect(wrapTicket("a b c", 3)).toEqual(["a b", "c"]);
});

it("renders a ticket-shaped PDF cut to its own length", async () => {
  const pdf = await ticketPdf(model, {
    name: "Demo Bistro", legalName: "Demo Bistro S.A. de C.V.", rfc: "DBI010101AB1",
    regime: "601 General de Ley Personas Morales",
    addressLines: ["Av. Los Pinos 245, Int. 3", "Col. Centro, C.P. 44100", "Guadalajara, Jalisco"], phone: "(33) 2456 7890",
  }, text, { last4: "K7P2", progress: 5, goal: 8, message: "Te faltan 3 para Postre gratis" }, "https://table-tap-star.vercel.app/dashboard/bills?order=x");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  if (process.env.TICKET_SAMPLE) writeFileSync(process.env.TICKET_SAMPLE, pdf);
});
