import { beforeEach, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { corteFrom, EMPTY_CORTE, type Corte } from "@/lib/corte";
import CorteCard from "@/components/dashboard/analytics/CorteCard";

vi.mock("@/components/dashboard/cash/ShiftBlock", () => ({ default: () => null }));
beforeEach(() => { vi.stubGlobal("React", React); });
const render = (corte: Corte) => renderToStaticMarkup(<CorteCard corte={corte} shifts={[]} currency="MXN"
  restaurantName="Restaurant" day="Today" timeZone="UTC" />);

it("I12: a refund-only MX$100 cash day shows the negative drawer, return and print button", () => {
  const corte = corteFrom([], [{ action: "refunded", detail: "amount=100 method=cash collector=cashier" }]);
  expect(corte.totals.cash).toBe(-100);
  const html = render(corte);
  expect(html).not.toContain("corte.empty");
  expect(html).toContain("cashier");
  expect(html).toContain("corte.refunded");
  expect(html).toContain("corte.print");
});

it("leaves a day with no activity empty", () => {
  expect(render(EMPTY_CORTE)).toContain("corte.empty");
});

it.each(["writtenOff", "discounted", "onAccount", "accountsOwed", "unverifiedAdjustments"] as const)("shows %s even without a collection", field => {
  const html = render({ ...EMPTY_CORTE, [field]: 100 });
  expect(html).not.toContain("corte.empty");
  expect(html).toContain("corte.print");
});

it("shows negative online money on a card-return-only day", () => {
  const corte = corteFrom([], [{ action: "refunded", detail: "amount=100 method=card" }]);
  expect(corte.online).toBe(-100);
  expect(render(corte)).toContain("corte.online");
});
