import { describe, expect, it } from "vitest";
import { loyaltyStats } from "@/lib/loyalty/analytics";

const visit = (card: string, day: string, by = "w@x") => ({ card_id: card, visit_day: day, actor_email: by });

describe("what the visit card did over a period", () => {
  it("counts cards, visits and rewards as they came", () => {
    const s = loyaltyStats(
      [{ id: "a", created_at: "2026-09-01" }, { id: "b", created_at: "2026-09-02" }],
      [visit("a", "2026-09-01"), visit("b", "2026-09-02")],
      [{ created_at: "2026-09-03" }],
    );
    expect(s).toMatchObject({ cardsMade: 2, visits: 2, rewards: 1 });
  });

  it("says a card came back only when it was stamped on two different days", () => {
    const s = loyaltyStats([], [visit("a", "2026-09-01"), visit("a", "2026-09-05"), visit("b", "2026-09-02")], []);
    expect(s.cameBack).toBe(1);
  });

  it("puts the person with the most stamps first, so one out of line is seen", () => {
    const s = loyaltyStats([], [visit("a", "d1", "ana@x"), visit("b", "d1", "beto@x"), visit("c", "d1", "beto@x")], []);
    expect(s.byStaff).toEqual([{ actor: "beto@x", stamps: 2 }, { actor: "ana@x", stamps: 1 }]);
  });

  it("is all zeroes, not a failure, for a quiet period", () => {
    expect(loyaltyStats([], [], [])).toEqual({ cardsMade: 0, visits: 0, cameBack: 0, rewards: 0, byStaff: [] });
  });
});
