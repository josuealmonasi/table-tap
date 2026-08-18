import { describe, expect, it } from "vitest";
import { parsePlanLimit, planLimitText } from "@/lib/plan-error";

describe("reading the trigger's refusal", () => {
  it("picks apart what was refused, on which plan, at what ceiling", () => {
    expect(parsePlanLimit("tt_plan_limit tables servicio 25")).toEqual({
      kind: "tables",
      plan: "servicio",
      max: 25,
    });
  });

  it("finds it however the client wrapped the message", () => {
    // Different Supabase clients prefix this differently.
    const wrapped = 'ERROR: tt_plan_limit items carta 30 (SQLSTATE 23514)';
    expect(parsePlanLimit(wrapped)?.kind).toBe("items");
  });

  it("leaves ordinary failures alone", () => {
    // A network blip or a constraint violation must still show the generic
    // "couldn't save" toast, not a plan upsell.
    expect(parsePlanLimit("duplicate key value violates unique constraint")).toBeNull();
    expect(parsePlanLimit(null)).toBeNull();
    expect(parsePlanLimit("")).toBeNull();
  });

  it("says a tier does not include something, rather than 'includes 0'", () => {
    const hit = parsePlanLimit("tt_plan_limit tables carta 0")!;
    expect(planLimitText(hit).key).toBe("plan.none.tables");
  });

  it("names a key the catalogs actually have, with its substitutions", () => {
    const hit = parsePlanLimit("tt_plan_limit menus servicio 3")!;
    expect(planLimitText(hit)).toEqual({
      key: "plan.limit.menus",
      vars: { plan: "servicio", max: 3 },
    });
  });
});
