import { describe, expect, it } from "vitest";
import { shortMessage, shortText } from "@/lib/stock-message";

/** A stand-in for `useT`, so the test reads the shape and not the Spanish. */
const t = (key: string, vars: Record<string, string | number> = {}) =>
  `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(",")})`;

describe("telling somebody how short they are", () => {
  it("says how many are left, which is the thing they need", () => {
    // The refusal has always known this and every screen dropped it, so the
    // answer to "how many can I have then?" was a trip to the kitchen.
    expect(shortText({ name: "Calamari", available: 4 }, t)).toBe(
      "pos.shortSome(name=Calamari,n=4)",
    );
  });

  it("does not say '0 left', which is not a sentence anybody says", () => {
    // A dish that has gone entirely is a different conversation from one that
    // is merely short, so it gets its own words.
    expect(shortText({ name: "Ribeye", available: 0 }, t)).toBe("pos.shortNone(name=Ribeye)");
  });

  it("lists every dish that fell short, not just the first", () => {
    const msg = shortMessage(
      [
        { name: "Calamari", available: 4 },
        { name: "Ribeye", available: 0 },
      ],
      t,
    );
    expect(msg).toContain("Calamari");
    expect(msg).toContain("Ribeye");
    expect(msg).toContain("n=4");
  });

  it("still says something when the server sent no detail", () => {
    // A refusal we cannot explain is still a refusal, and silence at the till
    // with a customer waiting is the worst of the options.
    expect(shortMessage([], t)).toContain("pos.outOfStock");
  });
});
