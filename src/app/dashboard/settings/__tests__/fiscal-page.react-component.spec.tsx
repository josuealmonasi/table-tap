import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FISCAL_COLUMNS, FISCAL_KEYS, type FiscalSettings } from "@/lib/fiscal-settings";

const state = vi.hoisted(() => ({ role: "owner", columns: [] as string[], ids: [] as string[], error: false, missing: false }));
const fiscal = Object.fromEntries(FISCAL_KEYS.map(field => [field, `private ${field}`])) as FiscalSettings;
vi.mock("@/lib/page-guard", () => ({ requireManager: async () => ({ role: state.role, restaurant: { id: "own-r", name: "Cafe" } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async () => ({ data: null, error: null }), from: () => ({ select: (columns: string) => {
  state.columns.push(columns);
  return { eq: (_key: string, id: string) => {
    state.ids.push(id);
    return {
      maybeSingle: async () => ({ data: { print_token: "secret" }, error: null }),
      single: async () => ({ data: state.missing ? null : fiscal, error: state.error ? { message: "read failed" } : null }),
    };
  } };
} }) }) }));
vi.mock("@/lib/ordering-data", async () => await import("@/lib/unwrap"));
vi.mock("@/lib/plan-server", () => ({ getPlan: async () => null, allPlans: async () => [] }));
vi.mock("@/components/ui/ConfirmDialog", () => ({ ConfirmProvider: () => null }));
vi.mock("@/components/dashboard/settings/SettingsForm", () => ({ default: () => null }));
import SettingsPage from "../page";
beforeEach(() => { vi.stubGlobal("React", React); state.role = "owner"; state.columns = []; state.ids = []; state.error = false; state.missing = false; });
afterEach(() => vi.unstubAllGlobals());

it("reads fiscal columns through admin and passes them separately only for the owner", async () => {
  const page = await SettingsPage();
  expect(state.columns).toEqual(["print_token", FISCAL_COLUMNS]);
  expect(state.ids).toEqual(["own-r", "own-r"]);
  expect(page.props.children.props.fiscal).toEqual(fiscal);
  for (const field of FISCAL_KEYS) expect(page.props.children.props.restaurant).not.toHaveProperty(field);
  expect(JSON.stringify(page)).not.toContain("secret");
});
it("never selects fiscal columns or serializes a fiscal prop for the manager", async () => {
  state.role = "manager";
  const page = await SettingsPage();
  expect(state.columns).toEqual(["print_token"]);
  expect(page.props.children.props).not.toHaveProperty("fiscal");
  expect(JSON.stringify(page)).not.toContain("private");
});
it("fails closed on fiscal read error instead of presenting blank fields", async () => {
  state.error = true;
  await expect(SettingsPage()).rejects.toThrow("read failed");
});
it("fails closed when no private row is returned", async () => {
  state.missing = true;
  await expect(SettingsPage()).rejects.toThrow("Missing restaurant fiscal settings");
});
