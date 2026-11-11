// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "@/lib/i18n/context";
import { messagesFor, translate, type Locale } from "@/lib/i18n";
import { FISCAL_KEYS, type FiscalSettings } from "@/lib/fiscal-settings";
import type { Restaurant } from "@/lib/types";
import type { Role } from "@/lib/membership";
import SettingsForm from "../SettingsForm";
import FiscalCard from "../fiscal-card.react-component";

const save = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/hooks/useSettings", () => ({ useSettings: () => ({ saving: false, save }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/layout/Breadcrumb", () => ({ default: () => null }));
vi.mock("../PaymentsCard", () => ({ default: () => null }));
vi.mock("../CoverCard", () => ({ default: () => null }));
vi.mock("../InventoryCard", () => ({ default: () => null }));
vi.mock("../TicketTimesCard", () => ({ default: () => null }));
vi.mock("../PrintingCard", () => ({ default: () => null }));
vi.mock("../LogoCard", () => ({ default: () => null }));
vi.mock("../RestaurantCard", () => ({ default: () => null }));
vi.mock("../TaxCard", () => ({ default: () => null }));
vi.mock("../OrderingCard", () => ({ default: () => null }));
const empty = Object.fromEntries(FISCAL_KEYS.map(field => [field, null])) as FiscalSettings;
const restaurant: Restaurant = { id: "r", name: "Cafe", logo: null, tagline: null, currency: "MXN", service_pct: 0,
  service_enabled: false, accepting_orders: true, tax_pct: 0, tax_show_breakdown: false };
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("React", React); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); save.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function render(role: Role = "owner", locale: Locale = "es", fiscal = empty) {
  await act(async () => root.render(<LocaleProvider locale={locale}><SettingsForm restaurant={restaurant} role={role} fiscal={fiscal} /></LocaleProvider>));
}
async function type(field: string, value: string) {
  const input = host.querySelector<HTMLInputElement>(`input[name="${field}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
async function submit() { await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); }

it.each(["owner", "manager"] as const)("renders fiscal fields only for owner: %s", async role => {
  await render(role);
  expect(host.textContent?.includes("Datos fiscales y dirección")).toBe(role === "owner");
  expect(host.querySelectorAll("[name]:not([name=ticket-font])").length).toBe(role === "owner" ? 11 : 0);
});
it.each(["es", "en"] as const)("shows all labels and the hint in %s", async locale => {
  await render("owner", locale);
  for (const field of FISCAL_KEYS) expect(host.textContent).toContain(translate(messagesFor(locale), `fiscal.fields.${field}`));
  expect(host.textContent).toContain(translate(messagesFor(locale), "fiscal.hint"));
  expect(host.textContent).not.toContain("fiscal.");
  expect([...host.querySelectorAll("[name]:not([name=ticket-font])")].map(input => input.getAttribute("name")))
    .toEqual(["legal_name", "rfc", "tax_regime", "address_street", "address_ext_number", "address_int_number", "address_postal_code", "address_colonia", "address_municipality", "address_state", "ticket_phone"]);
  expect([...host.querySelectorAll<HTMLInputElement>("input")].every(input => !input.required && !input.disabled)).toBe(true);
});
it("pins the requested Mexican Spanish copy", async () => {
  await render();
  expect(host.textContent).toContain("Aparecen en tus tickets. Son opcionales, pero el SAT pide razón social, RFC, régimen y dirección en el comprobante.");
  expect(host.textContent).toContain("Municipio o alcaldía");
  expect(host.textContent).toContain("Número interior (opcional)");
});
it("offers exactly the requested SAT catalog and all 32 states", async () => {
  await render();
  const regimes = host.querySelector<HTMLSelectElement>("[name=tax_regime]")!;
  expect([...regimes.options].map(option => option.value)).toEqual(["", "601", "603", "605", "606", "607", "608", "610", "611", "612", "614", "615", "616", "620", "621", "622", "623", "624", "625", "626"]);
  expect(regimes.textContent).toContain("626 — Régimen Simplificado de Confianza");
  const states = host.querySelector<HTMLSelectElement>("[name=address_state]")!;
  expect(new Set([...states.options].map(option => option.value)).size).toBe(33);
  expect(states.textContent).toContain("Ciudad de México");
});
it("uppercases RFC while typing and saves through the existing flow", async () => {
  await render();
  const input = await type("rfc", "añ&x010203a12");
  expect(input.value).toBe("AÑ&X010203A12");
  await type("legal_name", "  Cafe SA  "); await type("address_postal_code", "01234");
  await submit();
  expect(save).toHaveBeenCalledWith({ ...empty, rfc: "AÑ&X010203A12", legal_name: "Cafe SA", address_postal_code: "01234" });
});
it.each(["es", "en"] as const)("blocks bad RFC and gives a helpful %s error that clears after correction", async locale => {
  await render("owner", locale); await type("rfc", "ABC"); await submit();
  expect(save).not.toHaveBeenCalled();
  const input = host.querySelector<HTMLInputElement>("[name=rfc]")!;
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(host.querySelector("[role=alert]")?.textContent).toBe(translate(messagesFor(locale), "fiscal.errors.rfc"));
  expect(host.querySelector("[role=alert]")?.id).toBe(input.getAttribute("aria-describedby"));
  await type("rfc", "ABC010203A12"); await submit();
  expect(save).toHaveBeenCalledTimes(1); expect(host.querySelector("[role=alert]")).toBeNull();
});
it("loads saved private values, including selected regime and state", async () => {
  await render("owner", "es", { ...empty, legal_name: "Private Cafe", tax_regime: "626", address_state: "Yucatán" });
  expect(host.querySelector<HTMLInputElement>("[name=legal_name]")?.value).toBe("Private Cafe");
  expect(host.querySelector<HTMLSelectElement>("[name=tax_regime]")?.value).toBe("626");
  expect(host.querySelector<HTMLSelectElement>("[name=address_state]")?.value).toBe("Yucatán");
});
it("disables only the save button during a save", async () => {
  await act(async () => root.render(<LocaleProvider locale="es"><FiscalCard fiscal={empty} saving save={save} /></LocaleProvider>));
  expect(host.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  expect([...host.querySelectorAll<HTMLInputElement>("input, select")].some(input => input.disabled)).toBe(false);
});

it("clears saved fields to null and saves selected regime and state", async () => {
  await render("owner", "es", { ...empty, legal_name: "Private Cafe", rfc: "ABC010203A12" });
  await type("legal_name", "   "); await type("rfc", "");
  await act(async () => {
    for (const [field, value] of [["tax_regime", "626"], ["address_state", "Yucatán"]]) {
      const select = host.querySelector<HTMLSelectElement>(`[name=${field}]`)!;
      select.value = value; select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });
  await submit();
  expect(save).toHaveBeenCalledWith({ ...empty, tax_regime: "626", address_state: "Yucatán" });
});

it.each(["owner", "manager"] as const)("offers the three ticket fonts, each with a sample, to the owner only: %s", async role => {
  await render(role);
  const radios = [...host.querySelectorAll<HTMLInputElement>("input[name=ticket-font]")];
  expect(radios.map(r => r.value)).toEqual(role === "owner" ? ["archivo", "plex", "classic"] : []);
  if (role !== "owner") return;
  // Archivo is the default when the restaurant never chose.
  expect(radios.find(r => r.checked)?.value).toBe("archivo");
  const samples = [...host.querySelectorAll<HTMLAnchorElement>("a[href^='/api/settings/ticket-preview']")];
  expect(samples.map(a => a.getAttribute("href"))).toEqual(["archivo", "plex", "classic"].map(f => `/api/settings/ticket-preview?font=${f}`));
  expect(samples.every(a => a.target === "_blank")).toBe(true);
  await act(async () => radios[1].click());
  expect(save).toHaveBeenCalledWith({ ticket_font: "plex" });
});
