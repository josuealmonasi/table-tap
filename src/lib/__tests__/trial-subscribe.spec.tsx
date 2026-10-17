import React from "react";
import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PlanLimits } from "@/lib/plan";
vi.mock("@/lib/i18n/context", () => ({ useT: () => (key: string) => key }));
vi.mock("@/components/ui/Toast", () => ({ useToast: () => vi.fn() }));
vi.stubGlobal("React", React);
vi.mock("@/components/ui/icons", () => ({ CheckIcon: () => null }));
const { default: PlanTiers } = await import("@/components/dashboard/plan/PlanTiers");
it("D12 offers purchase of the current trial tier", () => {
  const html = renderToStaticMarkup(<PlanTiers current="servicio" trialing catalog={[
    { plan: "servicio", monthly_price: 699, order_fee: 1, max_tables: 15, max_staff: 10 } as PlanLimits,
  ]} currency="MXN" foundingNumber={null} foundersTaken={0} />);
  expect(html).toContain("plan.choose");
  expect(html).not.toContain('disabled=""');
});
it("keeps the current paid tier marked without another purchase button", () => {
  const html = renderToStaticMarkup(<PlanTiers current="servicio" catalog={[
    { plan: "servicio", monthly_price: 699, order_fee: 1, max_tables: 15, max_staff: 10 } as PlanLimits,
  ]} currency="MXN" foundingNumber={null} foundersTaken={0} />);
  expect(html).toContain('disabled=""');
  expect(html).not.toContain("plan.choose");
});
