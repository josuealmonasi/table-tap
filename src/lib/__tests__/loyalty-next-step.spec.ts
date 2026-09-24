import { describe, expect, it } from "vitest";
import { nextStep } from "@/lib/loyalty/next-step";
import { standing } from "@/lib/loyalty/standing";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { translate } from "@/lib/i18n";

const one = (reward: string) => [{ visits: 8, reward }];
const ladder = [
  { visits: 4, reward: "Coffee" },
  { visits: 8, reward: "Dessert" },
  { visits: 12, reward: "Meal" },
];

describe("what a card needs next, said once for the diner and the staff", () => {
  it("counts down to the reward, by name", () => {
    expect(nextStep(standing(3, one("Free dessert")))).toEqual({ key: "rewards.toGo", vars: { n: 5, reward: "Free dessert" } });
  });

  it("says one visit in the singular", () => {
    expect(nextStep(standing(7, one("Free dessert"))).key).toBe("rewards.toGoOne");
    expect(nextStep(standing(7, one(""))).key).toBe("rewards.toGoOneNoReward");
  });

  it("says the reward is ready, and what it is", () => {
    expect(nextStep(standing(8, one(" Free dessert ")))).toEqual({ key: "rewards.readyHint", vars: { reward: "Free dessert" } });
  });

  it("still makes sense when the owner wrote no reward", () => {
    expect(nextStep(standing(8, one("  "))).key).toBe("rewards.readyHintNoReward");
    expect(nextStep(standing(2, one(""))).key).toBe("rewards.toGoNoReward");
  });

  it("on a ladder, names the next reward and counts to it, not to the end of the round", () => {
    expect(nextStep(standing(2, ladder))).toEqual({ key: "rewards.toGo", vars: { n: 2, reward: "Coffee" } });
    expect(nextStep(standing(5, ladder, [4]))).toEqual({ key: "rewards.toGo", vars: { n: 3, reward: "Dessert" } });
    expect(nextStep(standing(9, ladder, [4, 8]))).toEqual({ key: "rewards.toGo", vars: { n: 3, reward: "Meal" } });
  });

  it("on a ladder, a reward skipped is the one that is ready", () => {
    expect(nextStep(standing(12, ladder))).toEqual({ key: "rewards.readyHint", vars: { reward: "Coffee" } });
  });

  it("reads as a finished sentence in both languages, every case", () => {
    const cases = ["Postre gratis", ""].flatMap(r => [standing(3, one(r)), standing(7, one(r)), standing(8, one(r))]);
    cases.push(standing(5, ladder, [4]), standing(12, ladder));
    for (const messages of [en, es]) {
      for (const s of cases) {
        const { key, vars } = nextStep(s);
        const said = translate(messages, key, vars);
        expect(said, key).not.toBe(key);
        expect(said, key).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });
});
