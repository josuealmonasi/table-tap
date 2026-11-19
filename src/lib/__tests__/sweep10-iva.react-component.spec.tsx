import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { billAmounts } from "@/lib/bill-amounts";
import { tableBill } from "@/lib/table-bill";
import { ivaSplit } from "@/lib/money";
import type { Order, Restaurant } from "@/lib/types";
import BillTotals from "@/components/customer/BillTotals";

vi.stubGlobal("React", React);
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, unknown>) => `${key}${vars ? JSON.stringify(vars) : ""}` }));
const order = (rate: number): Order => ({ id: "food", total: 116, subtotal: 116, tip: 0,
  service_fee: 0, discount: 0, tax_pct: rate, currency: "MXN", items: [], status: "received", paid: false } as unknown as Order);

it.each([[16, 0], [0, 16]])("F4 keeps saved IVA %s when today's setting is %s", (saved, today) => {
  const amounts = billAmounts(tableBill([order(saved)], []), "all", null, 0, null);
  const html = renderToStaticMarkup(<BillTotals amounts={amounts} restaurant={{ currency: "MXN", tax_pct: today,
    tax_show_breakdown: true } as Restaurant} tipPct={0} tipCustom={null} />);
  if (saved) { expect(html).toContain("totals.iva"); expect(html).toContain("MX$16.00"); }
  else expect(html).not.toContain("totals.iva");
});

it("F5 never invents a cent when net and IVA are both half a cent", () => {
  const split = ivaSplit(0.01, 100);
  expect(Math.round(split.net * 100) + Math.round(split.iva * 100)).toBe(1);
});
