import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { messagesFor } from "@/lib/i18n";

const schema = readFileSync("supabase/schema.sql", "utf8");
const latest = (name: string): string =>
  [...schema.matchAll(/create or replace function public\.([a-z_0-9]+)\([\s\S]*?\$\$;/g)].filter(m => m[1] === name).at(-1)?.[0] ?? "";

describe("the service charge is gone", () => {
  it("no copy still offers it", () => {
    for (const locale of ["es", "en"] as const) {
      const m = messagesFor(locale) as unknown as Record<string, Record<string, unknown>>;
      expect(String(m.nav.settingsDesc)).not.toMatch(/servic/i);
      for (const key of ["serviceFee", "serviceFeeHint", "serviceFeePct", "serviceOn", "serviceOff"]) {
        expect(m.dash[key], `${locale} dash.${key}`).toBeUndefined();
      }
    }
  });

  it("removing a fee never takes a discounted bill below zero", () => {
    // MX$100 food + MX$10 service - MX$105 discount = MX$5: only MX$5 may come off.
    expect(latest("reprice_open_service")).toContain("greatest(round(o.subtotal * p_pct / 100, 2), round(o.service_fee - o.total, 2)) wanted");
  });

  it("the migration picks restaurants by the unpaid fees they hold, not by their settings", () => {
    const start = schema.indexOf("do $$ declare r record; begin\n  for r in select distinct restaurant_id id from orders");
    expect(start).toBeGreaterThan(schema.lastIndexOf("create or replace function public.reprice_open_service("));
    const block = schema.slice(start, schema.indexOf("end $$;", start));
    expect(block).toContain("where paid = false and service_fee > 0 and total > 0");
    expect(block).not.toMatch(/service_enabled|service_pct/);
  });
});
