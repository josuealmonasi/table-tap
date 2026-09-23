import { describe, expect, it } from "vitest";
import { cardFace } from "@/lib/loyalty/face";

describe("what every presentation of a card draws from", () => {
  const restaurant = { name: "Demo Bistro", logo: "🍽️", logo_url: null };
  const card = { code: "K7QM3XW9TB4R", progress: 3, ladder: [{ visits: 8, reward: "  Postre gratis " }] };

  it("prints the code in groups and points the QR at the rewards page", () => {
    const face = cardFace(restaurant, card, "https://tabletap.mx");
    expect(face.printedCode).toBe("K7QM-3XW9-TB4R");
    expect(face.qrPayload).toBe("https://tabletap.mx/rewards?c=K7QM3XW9TB4R");
    expect(face.standing.next).toEqual({ visits: 8, reward: "Postre gratis" });
    expect(face.standing).toMatchObject({ visits: 3, goal: 8, toGo: 5, ready: false });
  });

  it("shows the uploaded mark over the emoji, and only one of them", () => {
    const withMark = cardFace({ ...restaurant, logo_url: "https://x/logo.png" }, card, "https://t");
    expect(withMark.logoUrl).toBe("https://x/logo.png");
    expect(withMark.logoEmoji).toBeNull();
    const withEmoji = cardFace(restaurant, card, "https://t");
    expect(withEmoji.logoUrl).toBeNull();
    expect(withEmoji.logoEmoji).toBe("🍽️");
  });

  it("carries the same QR whatever draws the card", () => {
    // The promise a wallet presentation depends on: a card drawn anywhere
    // scans to the same place, so staff never learn a second way to stamp.
    const a = cardFace(restaurant, card, "https://tabletap.mx");
    const b = cardFace(restaurant, { ...card, progress: 7 }, "https://tabletap.mx");
    expect(a.qrPayload).toBe(b.qrPayload);
  });

  it("carries every reward on the ladder, in order, whatever order it was given in", () => {
    const face = cardFace(restaurant, {
      ...card,
      ladder: [{ visits: 12, reward: "Comida" }, { visits: 4, reward: " Café " }, { visits: 8, reward: "Postre" }],
    }, "https://t");
    expect(face.standing.steps.map(s => [s.visits, s.reward])).toEqual([[4, "Café"], [8, "Postre"], [12, "Comida"]]);
    expect(face.standing.goal).toBe(12);
  });
});
