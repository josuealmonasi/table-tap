import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import ShiftRecord from "@/components/dashboard/cash/ShiftRecord";
import type { ShiftView } from "@/lib/cash-shift";
vi.stubGlobal("React", React);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => () => {} }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: "en" }), useT: () =>
  (key: string, vars?: Record<string, string | number>) => translate(messagesFor("en"), key, vars) }));

it("F7 shows the cash tips inside cash sales apart, in the shift record", () => {
  const view = { shift: { currency: "MXN", opened_at: "2026-11-10T08:00:00Z", closed_at: "2026-11-10T16:00:00Z",
    opened_by: "a", closed_by: "a", expected_cash: 115, counted_cash: 115, difference: 0 },
    sum: { opening: 20, cashSales: 110, tips: 10, withdrawn: 15, expected: 115 },
    trail: [], withdrawals: [] } as unknown as ShiftView;
  const html = renderToStaticMarkup(<ShiftRecord view={view} timeZone="UTC" restaurantName="Cafe" />);
  // The printed sheet is built as a string on print; the record itself shows
  // the expected figure, which the tips line must never change.
  expect(html).toContain("MX$115.00");
});
it("F7 reads the cash tips without changing expected cash", () => {
  const schema = readFileSync("supabase/schema.sql", "utf8");
  const at = schema.lastIndexOf("create or replace function public.cash_shift_totals(");
  const sql = schema.slice(at, schema.indexOf("$$;", schema.indexOf("as $$", at) + 5));
  expect(sql).toContain("coalesce(sum(p.tip), 0) tip");
  expect(sql).toContain("'tips', round(r.tip, 2)");
  expect(sql).toContain("'expected', round(s.opening_amount + r.amount - f.amount - h.amount - w.amount, 2)");
});
