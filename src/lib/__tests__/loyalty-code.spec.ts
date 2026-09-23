import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { CODE_LENGTH, codeFromScan, formatCode, newCode, normalizeCode, rewardsLink } from "@/lib/loyalty/code";

// The database's own rule for a code, read out of the schema. A code the app
// makes and the table refuses is a card nobody can create.
const schema = fs.readFileSync("supabase/schema.sql", "utf8");
const sqlRule = /code\s+text not null unique check \(code ~ '([^']+)'\)/.exec(schema)?.[1];

describe("a loyalty card's code", () => {
  it("is something the database accepts, every time", () => {
    expect(sqlRule, "loyalty_cards.code lost its check constraint").toBeTruthy();
    const rule = new RegExp(sqlRule!);
    const codes = Array.from({ length: 2000 }, newCode);
    expect(codes.filter(c => !rule.test(c))).toEqual([]);
    expect(new Set(codes).size, "two new cards were handed the same code").toBe(codes.length);
  });

  it("uses the whole alphabet, not a corner of it", () => {
    const seen = new Set(Array.from({ length: 2000 }, newCode).join(""));
    expect(seen.size).toBe(32);
  });

  it("reads what a diner types the way they meant it", () => {
    expect(normalizeCode("k7qm-3xw9-tb4r")).toBe("K7QM3XW9TB4R");
    expect(normalizeCode(" K7QM 3XW9 TB4R ")).toBe("K7QM3XW9TB4R");
    // O for zero, I and L for one: the letters the alphabet leaves out.
    expect(normalizeCode("OOOO-IIII-LLLL")).toBe("000011111111");
  });

  it("refuses what cannot be a code", () => {
    expect(normalizeCode("K7QM-3XW9")).toBeNull();
    expect(normalizeCode("K7QM-3XW9-TB4R-9")).toBeNull();
    expect(normalizeCode("K7QM-3XW9-TB4U")).toBeNull();
    expect(normalizeCode("K7QM-3XW9-TB4!")).toBeNull();
    expect(normalizeCode("")).toBeNull();
  });

  it("prints in three groups of four", () => {
    expect(formatCode("K7QM3XW9TB4R")).toBe("K7QM-3XW9-TB4R");
    expect(formatCode("K7QM3XW9TB4R").replace(/-/g, "")).toHaveLength(CODE_LENGTH);
  });

  it("points its QR at the diner's own progress", () => {
    expect(rewardsLink("https://tabletap.mx/", "K7QM3XW9TB4R")).toBe("https://tabletap.mx/rewards?c=K7QM3XW9TB4R");
  });

  it("finds the code in whatever a camera read", () => {
    expect(codeFromScan("https://tabletap.mx/rewards?c=K7QM3XW9TB4R")).toBe("K7QM3XW9TB4R");
    expect(codeFromScan("K7QM-3XW9-TB4R")).toBe("K7QM3XW9TB4R");
    // Somebody else's QR — a menu, a Wi-Fi code — is not a card.
    expect(codeFromScan("https://tabletap.mx/r/abc")).toBeNull();
    expect(codeFromScan("WIFI:S:Casa;T:WPA;P:secret;;")).toBeNull();
  });
});
