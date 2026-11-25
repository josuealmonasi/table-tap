import { describe, expect, it } from "vitest";
import { billingSummary, type RestaurantBilling } from "@/lib/admin-billing-summary";
import { messagesFor, translate } from "@/lib/i18n";

const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);
const base: RestaurantBilling = {
  plan: "casa", plan_status: "active", stripe_subscription_id: null, subscribed_price: null,
  trial_ends_at: null, plan_ends_at: null, plan_period_ends_at: null,
};
const line = (patch: Partial<RestaurantBilling>) => billingSummary({ ...base, ...patch }, t, "es");

describe("how a restaurant pays, as the admin list says it", () => {
  it.each([
    ["en", "Closing · deletion pending"],
    ["es", "En cierre · eliminación pendiente"],
  ] as const)("shows closing in %s even after the billing status changes", (locale, text) => {
    const translateForLocale = (key: string) => translate(messagesFor(locale), key);
    expect(billingSummary({ ...base, closing_at: "2026-11-25T06:04:00Z", plan_status: "locked" },
      translateForLocale, locale)).toEqual({ text, tone: "warn" });
  });

  it("a paying subscription: price and renewal date", () => {
    const s = line({ stripe_subscription_id: "sub_1", subscribed_price: 1899, plan_period_ends_at: "2026-12-12T18:00:00Z" });
    expect(s.tone).toBe("ok");
    expect(s.text).toMatch(/^Stripe · .*1,899.*\/mes · renueva el 12 dic/);
  });

  it("a cancelled subscription still running: the day it ends, as a warning", () => {
    expect(line({ stripe_subscription_id: "sub_1", subscribed_price: 1899, plan_ends_at: "2026-12-12T18:00:00Z" }))
      .toEqual({ text: "Stripe · cancelado, activo hasta el 12 dic", tone: "warn" });
  });

  it("overdue and locked outrank everything else", () => {
    expect(line({ stripe_subscription_id: "sub_1", plan_status: "past_due" }).tone).toBe("danger");
    expect(line({ plan_status: "locked" })).toEqual({ text: "Bloqueado por falta de pago", tone: "danger" });
  });

  it("no subscription: a trial or an unpaid assigned tier ends on its date", () => {
    expect(line({ plan_status: "trialing", trial_ends_at: "2026-11-24T05:59:00Z" }))
      .toEqual({ text: "Sin suscripción · hasta el 23 nov, luego Carta", tone: "warn" });
  });

  it("Carta is free; any other tier with no subscription was assigned at no charge", () => {
    expect(line({ plan: "carta" }).text).toBe("Gratis");
    expect(line({ plan: "grupo" }).text).toBe("Asignado sin cobro");
  });
});
