import { describe, expect, it } from "vitest";
import { nextStep } from "@/lib/loyalty/next-step";
import { standing } from "@/lib/loyalty/standing";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { translate } from "@/lib/i18n";

describe("what a card needs next, said once for the diner and the staff", () => {
  it("counts down to the reward, by name", () => {
    expect(nextStep(standing(3, 8), "Free dessert")).toEqual({ key: "rewards.toGo", vars: { n: 5, reward: "Free dessert" } });
  });

  it("says one visit in the singular", () => {
    expect(nextStep(standing(7, 8), "Free dessert").key).toBe("rewards.toGoOne");
    expect(nextStep(standing(7, 8), "").key).toBe("rewards.toGoOneNoReward");
  });

  it("says the reward is ready, and what it is", () => {
    expect(nextStep(standing(8, 8), " Free dessert ")).toEqual({ key: "rewards.readyHint", vars: { reward: "Free dessert" } });
  });

  it("still makes sense when the owner wrote no reward", () => {
    expect(nextStep(standing(8, 8), "  ").key).toBe("rewards.readyHintNoReward");
    expect(nextStep(standing(2, 8), "").key).toBe("rewards.toGoNoReward");
  });

  it("reads as a finished sentence in both languages, every case", () => {
    const cases = [standing(3, 8), standing(7, 8), standing(8, 8)];
    for (const messages of [en, es]) {
      for (const s of cases) {
        for (const reward of ["Postre gratis", ""]) {
          const { key, vars } = nextStep(s, reward);
          const said = translate(messages, key, vars);
          expect(said, key).not.toBe(key);
          expect(said, key).not.toMatch(/\{[a-z]+\}/);
        }
      }
    }
  });
});
