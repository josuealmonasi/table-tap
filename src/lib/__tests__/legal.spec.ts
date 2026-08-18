import { describe, expect, it } from "vitest";
import { needsTerms, TERMS_VERSION } from "@/lib/legal";

describe("who still has to accept the terms", () => {
  it("does not ask again once the current version is accepted", () => {
    expect(needsTerms(TERMS_VERSION)).toBe(false);
  });

  it("asks anyone who accepted an older version", () => {
    expect(needsTerms("2020-01-01")).toBe(true);
  });

  it("asks anyone who has never accepted", () => {
    // Signed up before the terms existed. Treating that as consent would be
    // recording an agreement nobody made.
    expect(needsTerms(null)).toBe(true);
    expect(needsTerms(undefined)).toBe(true);
    expect(needsTerms("")).toBe(true);
  });
});
