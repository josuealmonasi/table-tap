import { describe, expect, it } from "vitest";
import { checkLadder, checkProgram, ladderLines, ladderOf, STEPS_MAX } from "@/lib/loyalty/ladder";
import { standing } from "@/lib/loyalty/standing";
import { en } from "@/lib/i18n/en";
import { es } from "@/lib/i18n/es";
import { translate } from "@/lib/i18n";

const ladder = [
  { visits: 4, reward: "Coffee" },
  { visits: 8, reward: "Dessert" },
  { visits: 12, reward: "Meal" },
];

describe("a card's ladder, as stored", () => {
  it("is its steps, in order of visits", () => {
    expect(ladderOf([{ visits: 8, reward: "b" }, { visits: 4, reward: "a" }], 8, "b")).toEqual([
      { visits: 4, reward: "a" },
      { visits: 8, reward: "b" },
    ]);
  });

  it("is one step — its goal and the program's reward — for anything saved before the ladder", () => {
    expect(ladderOf(null, 8, "Free dessert")).toEqual([{ visits: 8, reward: "Free dessert" }]);
    expect(ladderOf([], 6, "")).toEqual([{ visits: 6, reward: "" }]);
  });
});

describe("a ladder somebody typed", () => {
  it("is sorted, and its rewards trimmed", () => {
    expect(checkLadder([{ visits: 12, reward: " Meal " }, { visits: 4, reward: "Coffee" }])).toEqual({
      steps: [{ visits: 4, reward: "Coffee" }, { visits: 12, reward: "Meal" }],
    });
  });

  it(`holds at most ${STEPS_MAX} rewards`, () => {
    const five = [4, 8, 12, 16, 20].map(visits => ({ visits, reward: "x" }));
    expect(checkLadder(five)).toEqual({ error: "apiErr.loyaltySteps", vars: { max: STEPS_MAX } });
    expect(checkLadder(five.slice(0, 4))).toHaveProperty("steps");
  });

  it("refuses two rewards at the same number of visits", () => {
    expect(checkLadder([{ visits: 8, reward: "a" }, { visits: 8, reward: "b" }])).toEqual({ error: "apiErr.loyaltyStepsRepeat" });
  });

  it("refuses visits out of bounds or not whole", () => {
    for (const visits of [1, 51, 4.5, "8", null, -4]) {
      expect(checkLadder([{ visits, reward: "a" }]), String(visits)).toMatchObject({ error: "apiErr.loyaltyGoal" });
    }
  });

  it("refuses a blank reward, and says which kind of blank", () => {
    expect(checkLadder([{ visits: 8, reward: "  " }])).toEqual({ error: "apiErr.loyaltyRewardNeeded" });
    expect(checkLadder([{ visits: 4, reward: "a" }, { visits: 8, reward: "" }])).toEqual({ error: "apiErr.loyaltyStepReward" });
  });

  it("refuses a reward too long to print", () => {
    expect(checkLadder([{ visits: 8, reward: "x".repeat(81) }])).toMatchObject({ error: "apiErr.loyaltyReward" });
  });

  it("refuses anything that is not a list", () => {
    for (const raw of [undefined, null, {}, "8", []]) {
      expect(checkLadder(raw)).toHaveProperty("error");
    }
  });
});

describe("a program as the owner saves it", () => {
  it("takes its goal and reward from the last step", () => {
    expect(checkProgram(true, ladder)).toEqual({ steps: ladder, goal: 12, reward: "Meal" });
  });

  it("switched off, may be just a number of visits with no reward yet — and then has no ladder", () => {
    expect(checkProgram(false, [{ visits: 8, reward: "" }])).toEqual({ steps: [], goal: 8, reward: "" });
    expect(checkProgram(false, [{ visits: 60, reward: "" }])).toMatchObject({ error: "apiErr.loyaltyGoal" });
  });

  it("switched on, needs every reward written", () => {
    expect(checkProgram(true, [{ visits: 8, reward: "" }])).toEqual({ error: "apiErr.loyaltyRewardNeeded" });
    expect(checkProgram(false, [{ visits: 4, reward: "a" }, { visits: 8, reward: "" }])).toEqual({ error: "apiErr.loyaltyStepReward" });
  });

  it("every refusal reads as a finished sentence in both languages", () => {
    const refusals = [
      checkProgram(true, [{ visits: 8, reward: "" }]),
      checkProgram(true, [{ visits: 4, reward: "a" }, { visits: 8, reward: "" }]),
      checkProgram(true, [{ visits: 8, reward: "a" }, { visits: 8, reward: "b" }]),
      checkProgram(true, [4, 8, 12, 16, 20].map(visits => ({ visits, reward: "x" }))),
      checkProgram(true, [{ visits: 1, reward: "a" }]),
      checkProgram(true, [{ visits: 8, reward: "x".repeat(81) }]),
    ];
    for (const messages of [en, es]) {
      for (const r of refusals) {
        if (!("error" in r)) throw new Error("expected a refusal");
        const said = translate(messages, r.error, r.vars);
        expect(said, r.error).not.toBe(r.error);
        expect(said, r.error).not.toMatch(/\{[a-z]+\}/);
      }
    }
  });
});

describe("where a card stands on its ladder", () => {
  it("counts towards the goal, as a card of one reward always has", () => {
    expect(standing(3, [{ visits: 8, reward: "r" }])).toMatchObject({ visits: 3, goal: 8, toGo: 5, ready: false });
    expect(standing(8, [{ visits: 8, reward: "r" }])).toMatchObject({ visits: 8, goal: 8, toGo: 0, ready: true });
  });

  it("never shows more visits than the round, even with visits to carry over", () => {
    expect(standing(10, [{ visits: 8, reward: "r" }])).toMatchObject({ visits: 8, goal: 8, toGo: 0, ready: true });
  });

  it("does not go below nothing", () => {
    expect(standing(-2, [{ visits: 8, reward: "r" }])).toMatchObject({ visits: 0, goal: 8, toGo: 8, ready: false });
  });

  it("the round is the last step; the next reward is the lowest not yet redeemed", () => {
    const s = standing(5, ladder, [4]);
    expect(s.goal).toBe(12);
    expect(s.next).toEqual({ visits: 8, reward: "Dessert" });
    expect(s.toGo).toBe(3);
    expect(s.ready).toBe(false);
  });

  it("a diner at 12 who skipped the coffee is offered the coffee first — nothing earned is lost", () => {
    const s = standing(12, ladder);
    expect(s.next).toEqual({ visits: 4, reward: "Coffee" });
    expect(s.ready).toBe(true);
    expect(s.steps.map(x => x.reached)).toEqual([true, true, true]);
    expect(s.steps.map(x => x.done)).toEqual([false, false, false]);
  });

  it("marks what was redeemed this round", () => {
    const s = standing(9, ladder, [4, 8]);
    expect(s.steps.map(x => x.done)).toEqual([true, true, false]);
    expect(s.next).toEqual({ visits: 12, reward: "Meal" });
    expect(s.toGo).toBe(3);
  });
});

describe("the ladder, worded for a card", () => {
  it("is one line per reward, in both languages", () => {
    for (const messages of [en, es]) {
      const t = (key: string, vars?: Record<string, string | number>) => translate(messages, key, vars);
      const lines = ladderLines(ladder, t);
      expect(lines).toHaveLength(3);
      for (const line of lines) expect(line).not.toMatch(/\{[a-z]+\}/);
      expect(lines[0]).toContain("Coffee");
      expect(ladderLines([{ visits: 8, reward: "" }], t)[0]).toContain("8");
    }
  });
});
