import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { messagesFor, translate } from "@/lib/i18n";
import { planDescription } from "@/lib/plan-description";

// The owner approved one line per tier on 2026-11-11. The plans come from the
// schema's own check constraint, so a sixth tier without a description fails.
const schema = readFileSync("supabase/schema.sql", "utf8");
const plans = [...schema.matchAll(/check \(plan in \(([^)]*)\)\)/g)].at(-1)![1]
  .split(",").map(p => p.trim().replace(/'/g, ""));

it("knows the five tiers", () => {
  expect(plans).toEqual(["carta", "caja", "servicio", "casa", "grupo"]);
});

it.each(["es", "en"] as const)("every tier has a %s description, with no placeholder left unfilled", lang => {
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor(lang), key, vars);
  for (const plan of plans) {
    const line = planDescription(t, { plan, max_tables: 15 } as never);
    expect(line, plan).not.toBe(`plan.desc.${plan}`);
    expect(line, plan).not.toMatch(/[{}]/);
  }
});

it("reads the table count from the plan row, never from the copy", () => {
  const t = (key: string, vars?: Record<string, string | number>) => translate(messagesFor("es"), key, vars);
  expect(planDescription(t, { plan: "servicio", max_tables: 15 } as never)).toContain("hasta 15 mesas");
  expect(planDescription(t, { plan: "casa", max_tables: 50 } as never)).toContain("hasta 50 mesas");
  for (const lang of ["es", "en"] as const) {
    const desc = (messagesFor(lang) as unknown as { plan: { desc: Record<string, string> } }).plan.desc;
    for (const [plan, line] of Object.entries(desc)) expect(line, `${lang} ${plan}`).not.toMatch(/\d+\s*(mesas|tables)/);
  }
});
