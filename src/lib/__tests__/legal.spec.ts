import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

/**
 * The text and the version people are asked to accept.
 *
 * Two records of one fact, which is this app's recurring bug shape. The
 * documents moved twice — a clause about the camera, then one about the device
 * identifier stored with an order — and `TERMS_VERSION` did not, so every
 * restaurant kept an acceptance of a document they had never been shown.
 *
 * These fingerprints are not here to be admired: when one fails, read what
 * changed and then decide. A clarified sentence may honestly keep the version
 * — asking for consent to a typo teaches people to click through. A new
 * category of data does not. Either way the decision gets made by a person.
 */
describe("the text and the version cannot drift apart", () => {
  const fingerprint = (name: string): string =>
    createHash("sha256")
      .update(readFileSync(join(process.cwd(), "src/lib/legal", `${name}.json`), "utf8"))
      .digest("hex")
      .slice(0, 16);

  it("has terms that match the version in force", () => {
    expect({ version: TERMS_VERSION, text: fingerprint("terms-es") }).toEqual({
      version: "2026-09-16",
      text: "8a84f8c162b437e3",
    });
  });

  it("has a privacy notice that matches the version in force", () => {
    expect({ version: TERMS_VERSION, text: fingerprint("privacy-es") }).toEqual({
      version: "2026-09-16",
      text: "d651d59c0e67a456",
    });
  });
});
