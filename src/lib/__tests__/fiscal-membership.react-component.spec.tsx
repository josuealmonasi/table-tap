import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { FISCAL_KEYS } from "@/lib/fiscal-settings";

const state = vi.hoisted(() => ({ owner: false, role: "manager" }));
const row = { id: "r", name: "Cafe", currency: "MXN", print_token: "printer-secret",
  ...Object.fromEntries(FISCAL_KEYS.map(field => [field, `private ${field}`])) };
vi.mock("@/lib/current-user", () => ({ currentUser: async () => ({ id: "session-user" }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (table: string) => ({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === "restaurants"
    ? state.owner ? row : null : { role: state.role, restaurant: row }, error: null }) }) }),
}) }) }));
import { getMembership } from "@/lib/membership";
beforeEach(() => { state.owner = false; state.role = "manager"; });
it.each(["owner", "manager", "waiter", "cashier", "kitchen"])("strips fiscal values and printer token from %s membership restaurant", async role => {
  state.role = role;
  const membership = await getMembership();
  expect(membership?.role).toBe(role);
  expect(membership?.restaurant).toEqual({ id: "r", name: "Cafe", currency: "MXN" });
  expect(row).toHaveProperty("legal_name", "private legal_name");
});
it("also strips the founding owner's generic restaurant row", async () => {
  state.owner = true;
  expect((await getMembership())?.restaurant).toEqual({ id: "r", name: "Cafe", currency: "MXN" });
});
it("keeps fiscal fields out of the public menu projection and Restaurant type", () => {
  const projection = readFileSync("src/lib/public-menu-rows.ts", "utf8").match(/PUBLIC_RESTAURANT_COLUMNS = "([^"]+)"/)![1].split(", ");
  const type = readFileSync("src/lib/types.ts", "utf8").split("export type Restaurant = {")[1].split("\n};")[0];
  for (const field of FISCAL_KEYS) { expect(projection).not.toContain(field); expect(type).not.toContain(`${field}:`); }
});
