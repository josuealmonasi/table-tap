import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { disputeReport } from "@/lib/disputes/report";
import { dispute, movement } from "@/lib/disputes/__tests__/report-fixtures";
import type { CostsView } from "@/lib/costs/server";
import type { DisputeHistory } from "@/lib/disputes/types";
const state = vi.hoisted(() => ({ locale: "es" as "es" | "en", rows: [] as DisputeHistory[], error: false }));
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor(state.locale), key, vars),
  useLocale: () => ({ locale: state.locale }) }));
vi.mock("swr", () => ({ default: () => ({ data: { order: state.rows }, error: state.error }) }));

vi.mock("@/components/dashboard/costs/FeeCard", () => ({ default: () => null }));
vi.mock("@/components/dashboard/costs/ProductMargins", () => ({ default: () => null }));
vi.mock("@/components/dashboard/costs/RecipeDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/analytics/CorteCard", () => ({ default: () => <div>DRAWER</div> }));
vi.mock("@/components/dashboard/OrderHistory", () => ({ default: () => null }));
import Summary from "../DisputeSummary.react-component";
import History from "../DisputeHistory.react-component";
import MarginsPanel from "@/components/dashboard/costs/MarginsPanel";
import AnalyticsView from "@/components/dashboard/analytics/AnalyticsView";
const report = disputeReport([dispute], [movement], "2026-11-01", "2026-12-01", 0, 0);
const view: CostsView = { disputes: report, ingredients: [], recipes: [], products: [], margins: [], rises: [], unverifiedFees: 0,
  fees: { rate: 0, fees: 0, takings: 0, cash: 0, online: 0, terminal: 0 }, terminalFeePct: 0, taxPct: 0,
  period: { rows: [], revenue: 0, cost: 0, fees: 0, returned: 0, contribution: 0, uncosted: 0 } };
beforeEach(() => { vi.stubGlobal("React", React); state.locale = "es"; state.rows = []; state.error = false; });
it("Costs shows a current-period chargeback below contribution, even with no sales/recipes", () => {
  const html = renderToStaticMarkup(<MarginsPanel view={view} currency="MXN" />);
  expect(html).toContain("Ajustes por contracargos");
  expect(html).toContain("Contribución después de contracargos");
  expect(html).toContain("-MX$115.00");
  expect(html.indexOf("Ajustes por contracargos")).toBeGreaterThan(html.indexOf("tt-costs-period"));
  expect(html).not.toContain("Para empezar");
  expect(view.period.contribution).toBe(0);
});
it("foreign settlement is shown separately and excluded from the main-currency contribution", () => {
  const foreign = { ...report, currencies: [{ ...report.currencies[0], currency: "USD", net: -10 }] };
  const html = renderToStaticMarkup(<Summary report={foreign} contribution={50} currency="MXN" />);
  expect(html).toContain("-$10.00"); expect(html).toContain("MX$50.00");
  expect(html).toContain("Total incompleto"); expect(html).not.toContain("MX$40.00");
});
it("pending evidence remains visible even with no recorded movements", () => {
  const html = renderToStaticMarkup(<Summary report={{ currencies: [], pending: 1, review: 0, won: 1, lost: 0 }} contribution={0} currency="MXN" />);
  expect(html).toContain("pendientes de conciliación"); expect(html).toContain("Total incompleto");
  expect(html).toContain("Ganar no confirma la restitución");
});
it("Analytics renders Spanish chargebacks while retaining sales, order count and tips", () => {
  const data = { revenue: 200, orderCount: 2, avgTicket: 100, tips: 20, byDay: [], byHour: [], topProducts: [] };
  const html = renderToStaticMarkup(<AnalyticsView data={data} disputes={report} period="today" currency="MXN" restaurantId="r" rated={[]}
    corte={{} as never} shifts={[]} timeZone="America/Mexico_City" restaurantName="Cafe" dayLabel="Today" />);
  expect(html).toContain("Contracargos"); expect(html).toContain("Capital retirado"); expect(html).toContain("Comisiones de Stripe");
  expect(html).toContain("MX$200.00"); expect(html).toContain("MX$20.00"); expect(data.orderCount).toBe(2);
  expect(html).toContain("DRAWER");
});
it("history renders dated status, principal, actual fee and shared-charge explanation in Spanish", () => {
  state.rows = [{ ...dispute, shared: true, movements: [movement] }];
  const html = renderToStaticMarkup(<History disputes={state.rows} />);
  expect(html).toContain("Contracargo de MX$100.00"); expect(html).toContain("Ganado");
  expect(html).toContain("Capital retirado"); expect(html).toContain("MX$15.00");
  expect(html).toContain("varios pedidos"); expect(html).toContain("2026"); expect(html).toContain("pendientes de conciliación");
});
it("an order with no chargeback renders nothing of its own", () => {
  expect(renderToStaticMarkup(<History disputes={[]} />)).toBe("");
});
it("all dispute statuses and reporting labels have English and Spanish copy", () => {
  for (const locale of ["es", "en"] as const) {
    state.locale = locale;
    for (const status of ["needs_response", "under_review", "won", "lost", "warning_needs_response", "warning_under_review", "warning_closed", "prevented"])
      expect(translate(messagesFor(locale), `disputes.${status}`)).not.toContain("disputes.");
    expect(renderToStaticMarkup(<Summary report={report} />)).toContain(locale === "es" ? "Contracargos" : "Chargebacks");
  }
});
it("manager order history mounts the shared-charge lines for the current page", async () => {
  const { readFileSync } = await import("node:fs");
  expect(readFileSync("src/components/dashboard/OrderHistory.tsx", "utf8"))
    .toContain("{canReturn && <DisputeHistoryLines disputes={disputes.data?.[order.id] ?? []} />}");
});
it("a case set aside for review is its own count and state, in both languages, never pending", () => {
  for (const [locale, label] of [["es", "Requiere revisión"], ["en", "Needs review"]] as const) {
    state.locale = locale;
    const summary = renderToStaticMarkup(<Summary report={{ currencies: [], pending: 0, review: 2, won: 0, lost: 0 }} contribution={0} currency="MXN" />);
    expect(summary).toContain(`${label}: 2`);
    expect(summary).not.toContain(locale === "es" ? "pendientes de conciliación" : "awaiting reconciliation");
    expect(summary).toContain(locale === "es" ? "Total incompleto" : "Incomplete total");
    state.rows = [{ ...dispute, reconciliation_state: "needs_review", shared: false, movements: [] }];
    const history = renderToStaticMarkup(<History orderId="order" restaurantId="r" />);
    expect(history).toContain(label);
    expect(history).not.toContain(locale === "es" ? "pendientes de conciliación" : "awaiting reconciliation");
  }
});
