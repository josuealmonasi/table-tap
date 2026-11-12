// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { messagesFor, translate } from "@/lib/i18n";

// The fee ceiling counts cents with no currency: a restaurant with card fees
// this month changes currency from the 1st of next month (sweep 11, finding 2;
// the owner's decision, 2026-11-11).

const updateResult = vi.hoisted(() => ({ error: null as null | { message: string } }));
const update = vi.hoisted(() => vi.fn(() => ({ eq: async () => updateResult })));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ update }) }) }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ role: "owner", restaurantId: "r", email: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/activity-log", () => ({ logEvent: async () => {} }));
vi.mock("@/lib/api-error", () => ({ apiError: async (error: string, status = 400) => Response.json({ error }, { status }) }));
vi.mock("@/lib/i18n/context", () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars),
  useLocale: () => ({ locale: "es", setLocale: () => {} }),
}));
const { POST } = await import("@/app/api/settings/route");
const { default: RestaurantCard } = await import("@/components/dashboard/settings/RestaurantCard");

const schema = readFileSync("supabase/schema.sql", "utf8");
const drop = readFileSync("supabase/drop.sql", "utf8");
const fn = (name: string): string => schema.split(`create or replace function public.${name}(`)[1].split("$$;")[0];

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  update.mockClear(); updateResult.error = null;
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const select = (): HTMLSelectElement => [...container.querySelectorAll("select")].find(e => e.value === "MXN")!;

it("locks the currency only while this UTC month has unreleased, unreturned card fees", () => {
  const sql = fn("currency_locked_until");
  expect(sql).toContain("f.period = date_trunc('month', now() at time zone 'utc')::date");
  expect(sql).toContain("f.status <> 'released' and f.cents > f.refunded_cents");
  expect(sql).toContain("(date_trunc('month', now() at time zone 'utc') + interval '1 month')::date");
});

it("the database refuses the change itself, only when the currency actually changes", () => {
  expect(fn("guard_fee_month_currency")).toContain("new.currency is distinct from old.currency and public.currency_locked_until(new.id) is not null");
  expect(fn("guard_fee_month_currency")).toContain("raise exception 'currency locked until next month'");
  expect(schema).toContain("create trigger guard_fee_month_currency before update of currency on restaurants");
  expect(schema).toContain("grant execute on function public.currency_locked_until(uuid) to service_role;");
  expect(drop).toContain("drop function if exists public.guard_fee_month_currency() cascade;");
  expect(drop).toContain("drop function if exists public.currency_locked_until(uuid);");
});

it("the settings route answers the lock by name, not as a failed save", async () => {
  updateResult.error = { message: "currency locked until next month" };
  const response = await POST(new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify({ currency: "USD" }) }));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "apiErr.currencyLockedMonth" });
});

const restaurant = { name: "Demo", logo: "", tagline: "", currency: "MXN", timezone: "America/Mexico_City",
  service_pct: 10, service_enabled: false } as never;

it("Settings disables the currency and says from which day it can change", async () => {
  await act(async () => root.render(<RestaurantCard restaurant={restaurant} saving={false} save={async () => true} currencyLockedUntil="2026-12-01" />));
  expect(select().disabled).toBe(true);
  const hint = container.querySelector("#tt-currency-locked");
  expect(hint?.textContent).toBe("Ya hay comisiones por pagos con tarjeta este mes. Podrás cambiar la moneda a partir del 1 de diciembre.");
  expect(select().getAttribute("aria-describedby")).toBe("tt-currency-locked");
});

it("Settings leaves the currency free when nothing locks it", async () => {
  await act(async () => root.render(<RestaurantCard restaurant={restaurant} saving={false} save={async () => true} />));
  expect(select().disabled).toBe(false);
  expect(container.querySelector("#tt-currency-locked")).toBeNull();
});
