import { describe, expect, it } from "vitest";
import { cardFace } from "@/lib/loyalty/face";
import { standing } from "@/lib/loyalty/standing";

describe("where a card stands", () => {
  it("counts towards the goal", () => {
    expect(standing(3, 8)).toEqual({ visits: 3, goal: 8, toGo: 5, ready: false });
  });

  it("is ready at the goal, and says nothing is left", () => {
    expect(standing(8, 8)).toEqual({ visits: 8, goal: 8, toGo: 0, ready: true });
  });

  it("never shows more visits than the goal, even with visits to carry over", () => {
    expect(standing(10, 8)).toEqual({ visits: 8, goal: 8, toGo: 0, ready: true });
  });

  it("does not go below nothing", () => {
    expect(standing(-2, 8)).toEqual({ visits: 0, goal: 8, toGo: 8, ready: false });
  });
});

describe("what every presentation of a card draws from", () => {
  const restaurant = { name: "Demo Bistro", logo: "🍽️", logo_url: null };
  const program = { reward: "  Postre gratis " };
  const card = { code: "K7QM3XW9TB4R", goal: 8, progress: 3 };

  it("prints the code in groups and points the QR at the rewards page", () => {
    const face = cardFace(restaurant, program, card, "https://tabletap.mx");
    expect(face.printedCode).toBe("K7QM-3XW9-TB4R");
    expect(face.qrPayload).toBe("https://tabletap.mx/rewards?c=K7QM3XW9TB4R");
    expect(face.reward).toBe("Postre gratis");
    expect(face.standing).toEqual({ visits: 3, goal: 8, toGo: 5, ready: false });
  });

  it("shows the uploaded mark over the emoji, and only one of them", () => {
    const withMark = cardFace({ ...restaurant, logo_url: "https://x/logo.png" }, program, card, "https://t");
    expect(withMark.logoUrl).toBe("https://x/logo.png");
    expect(withMark.logoEmoji).toBeNull();
    const withEmoji = cardFace(restaurant, program, card, "https://t");
    expect(withEmoji.logoUrl).toBeNull();
    expect(withEmoji.logoEmoji).toBe("🍽️");
  });

  it("carries the same QR whatever draws the card", () => {
    // The promise a wallet presentation depends on: a card drawn anywhere
    // scans to the same place, so staff never learn a second way to stamp.
    const a = cardFace(restaurant, program, card, "https://tabletap.mx");
    const b = cardFace(restaurant, program, { ...card, progress: 7 }, "https://tabletap.mx");
    expect(a.qrPayload).toBe(b.qrPayload);
  });
});
