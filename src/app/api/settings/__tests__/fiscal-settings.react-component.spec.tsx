import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FISCAL_KEYS, TAX_REGIMES, MEXICAN_STATES, type FiscalField } from "@/lib/fiscal-settings";
import { messagesFor, translate, type Locale } from "@/lib/i18n";

const state = vi.hoisted(() => ({ role: "owner", locale: "es" as Locale, written: null as unknown, log: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/api-guard", () => ({ actingManager: async () => ({ role: state.role, restaurantId: "own-restaurant", email: "owner" }) }));
vi.mock("@/lib/plan-guard", () => ({ frozenBlocks: async () => null, planBlocks: async () => null }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({
  update: (patch: unknown) => { state.written = patch; return { eq: state.eq }; },
}) }) }));
vi.mock("@/lib/i18n/server", () => ({ getLocale: async () => state.locale }));
vi.mock("@/lib/activity-log", () => ({ logEvent: state.log }));
vi.mock("@/lib/public-menu-cache", () => ({ invalidatePublicMenu: vi.fn() }));
vi.mock("@/lib/service-reprice", () => ({ repriceOpenService: vi.fn() }));
import { POST } from "../route";

const post = (body: object) => POST(new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) }));
const valid: Record<FiscalField, string> = {
  legal_name: "Restaurante Ejemplo SA de CV", rfc: "ABC010203A12", tax_regime: "601",
  address_street: "Reforma", address_ext_number: "123-A", address_int_number: "2B",
  address_postal_code: "01234", address_colonia: "Centro", address_municipality: "Cuauhtémoc",
  address_state: "Ciudad de México", ticket_phone: "+52 (55) 1234-5678",
};
const invalid: Record<FiscalField, unknown> = {
  legal_name: "a".repeat(255), rfc: "bad-rfc", tax_regime: "999", address_street: "a".repeat(161),
  address_ext_number: "a".repeat(21), address_int_number: "a".repeat(21), address_postal_code: "1234",
  address_colonia: "a".repeat(121), address_municipality: "a".repeat(121), address_state: "California",
  ticket_phone: "555-abc-1234",
};
beforeEach(() => { state.role = "owner"; state.locale = "es"; state.written = null; state.log.mockClear(); state.eq.mockReset().mockResolvedValue({ error: null }); });

it.each(FISCAL_KEYS)("owner saves trimmed %s scoped to their restaurant", async field => {
  expect((await post({ [field]: `  ${valid[field]}  ` })).status).toBe(200);
  expect(state.written).toEqual({ [field]: valid[field] });
  expect(state.eq).toHaveBeenCalledWith("id", "own-restaurant");
  expect(state.log.mock.calls[0][0].detail).toBe(field);
});
it.each(FISCAL_KEYS)("manager cannot post %s, even with a permitted operational update", async field => {
  state.role = "manager";
  expect((await post({ accepting_orders: false, [field]: valid[field] })).status).toBe(403);
  expect(state.written).toBeNull(); expect(state.log).not.toHaveBeenCalled();
});
it.each(FISCAL_KEYS.flatMap(field => ["", "   ", null].map(value => ({ field, value }))))("clears $field with $value", async ({ field, value }) => {
  expect((await post({ [field]: value })).status).toBe(200);
  expect(state.written).toEqual({ [field]: null });
});
it.each(FISCAL_KEYS.flatMap(field => [42, false, {}, []].map(value => ({ field, value }))))("refuses nontext $field: $value", async ({ field, value }) => {
  expect((await post({ [field]: value })).status).toBe(400); expect(state.written).toBeNull();
});
it.each((["es", "en"] as const).flatMap(locale => FISCAL_KEYS.map(field => ({ locale, field }))))("returns a specific $locale 400 for $field", async ({ locale, field }) => {
  state.locale = locale;
  const response = await post({ [field]: invalid[field] });
  expect(response.status).toBe(400);
  const key = `fiscal.errors.${field}`;
  const message = translate(messagesFor(locale), key);
  expect(message).not.toBe(key);
  expect(await response.json()).toEqual({ error: message }); expect(state.written).toBeNull();
});
it.each(["ABC010203A12", "ABCD010203A12", "Ñ&X010203A12", "AÑ&X010203A12"])("accepts company/individual RFC %s", async rfc => {
  expect((await post({ rfc })).status).toBe(200); expect(state.written).toEqual({ rfc });
});
it.each(["abc010203A12", "AB010203A12", "ABCDE010203A12", "ABC01020A12", "ABC010203Ñ12", "ABC010203&12", "ABC010203A1", "ABC010203A123", "ABC０１０２０３A12", "ABC010203A12\nX"])("refuses malformed RFC %s", async rfc => {
  expect((await post({ rfc })).status).toBe(400); expect(state.written).toBeNull();
});
it.each(["123456", "12A45", "１２３４５", "1234\n5"])("refuses malformed postal code %s", async address_postal_code => {
  expect((await post({ address_postal_code })).status).toBe(400); expect(state.written).toBeNull();
});
it("keeps the existing manager operational save", async () => {
  state.role = "manager";
  expect((await post({ accepting_orders: false })).status).toBe(200);
  expect(state.written).toEqual({ accepting_orders: false });
});
it("accepts exact schema text limits and phone limits", async () => {
  const body = { legal_name: "a".repeat(254), address_street: "a".repeat(160), address_ext_number: "a".repeat(20),
    address_int_number: "a".repeat(20), address_colonia: "a".repeat(120), address_municipality: "a".repeat(120), ticket_phone: "1".repeat(20) };
  expect((await post(body)).status).toBe(200); expect(state.written).toEqual(body);
  expect((await post({ ticket_phone: "1234567" })).status).toBe(200);
});
it.each(["123456", "1".repeat(21), "1234567 ext 1"])("refuses phone shape or length %s", async ticket_phone => {
  expect((await post({ ticket_phone })).status).toBe(400); expect(state.written).toBeNull();
});
it("rejects the entire patch when one fiscal field is invalid", async () => {
  expect((await post({ legal_name: valid.legal_name, address_postal_code: "bad" })).status).toBe(400);
  expect(state.written).toBeNull();
});
it("reports a failed save instead of claiming success", async () => {
  state.eq.mockResolvedValue({ error: { message: "write failed" } });
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try { expect((await post({ legal_name: valid.legal_name })).status).toBe(500); expect(state.log).not.toHaveBeenCalled(); }
  finally { error.mockRestore(); }
});

it.each(TAX_REGIMES)("accepts supported SAT regime %s", async tax_regime => {
  expect((await post({ tax_regime })).status).toBe(200); expect(state.written).toEqual({ tax_regime });
});
it.each(MEXICAN_STATES)("accepts Mexican state %s", async address_state => {
  expect((await post({ address_state })).status).toBe(200); expect(state.written).toEqual({ address_state });
});

it.each([16, 8, 0])("owner saves the ticket's IVA rate %s", async ticket_vat_rate => {
  expect((await post({ ticket_vat_rate })).status).toBe(200);
  expect(state.written).toEqual({ ticket_vat_rate });
  expect(state.eq).toHaveBeenCalledWith("id", "own-restaurant");
});
it.each([12, "16", 16.5, -16, null, true])("refuses a ticket IVA rate that is not offered: %s", async ticket_vat_rate => {
  expect((await post({ ticket_vat_rate })).status).toBe(400); expect(state.written).toBeNull();
});
it("keeps the ticket's IVA rate the owner's", async () => {
  state.role = "manager";
  expect((await post({ ticket_vat_rate: 8 })).status).toBe(403); expect(state.written).toBeNull();
});
