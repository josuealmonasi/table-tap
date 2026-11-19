import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";

vi.mock("swr", () => ({ default: () => ({ data: {
  staff: 2, lastActivity: null,
  last30: { orders: 1, sales: [{ currency: "MXN", amount: 70 }], tips: [], fees: [{ currency: null, amount: 3 }], payments: [{ currency: "MXN", cash: 100, card: 0 }] },
  month: { orders: 0, sales: [], tips: [], fees: [], payments: [] },
} }) }));
vi.mock("../../components/dashboard/admin/AdminSupport", () => ({ default: () => null }));
vi.mock("@/components/ui/Modal", () => ({ Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/lib/i18n/context", () => ({ useLocale: () => ({ locale: "es" }), useT: () => (key: string) => translate(messagesFor("es"), key) }));
import AdminUsageDialog from "@/components/dashboard/admin/AdminUsageDialog";

it("shows money by currency and calls unknown fee currency out in Spanish", () => {
  vi.stubGlobal("React", React);
  const html = renderToStaticMarkup(<AdminUsageDialog id="r" name="Café" onClose={() => {}} />);
  expect(html).toContain("Moneda por confirmar");
  expect(html).toContain("MX$70.00");
  expect(html).toContain("Últimos 30 días");
  expect(html).toContain("Tarjeta");
  expect(html).not.toContain("common.");
});
