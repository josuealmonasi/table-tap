import { describe, expect, it } from "vitest";
import { setupLeft, setupSteps } from "@/lib/setup-steps";

/** The owner's checklist: worked out from what the restaurant has, never ticked. */
describe("what is left to set up", () => {
  const none = { hasDishes: false, hasTables: false, takesCards: false, prints: false, hasTeam: false };

  it("lists the five steps in order, two of them optional", () => {
    const steps = setupSteps(none);
    expect(steps.map(s => s.key)).toEqual(["menu", "tables", "payments", "printer", "team"]);
    expect(steps.filter(s => s.optional).map(s => s.key)).toEqual(["printer", "team"]);
  });

  it("marks each step done from the facts, and goes away when all are", () => {
    const steps = setupSteps({ ...none, hasDishes: true, takesCards: true });
    expect(steps.filter(s => s.done).map(s => s.key)).toEqual(["menu", "payments"]);
    expect(setupLeft(steps)).toBe(true);
    expect(setupLeft(setupSteps({ hasDishes: true, hasTables: true, takesCards: true, prints: true, hasTeam: true }))).toBe(false);
  });
});
