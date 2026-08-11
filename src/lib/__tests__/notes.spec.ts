import { describe, expect, it } from "vitest";
import { NOTE_MAX, capNote } from "@/lib/notes";

describe("capNote", () => {
  it("keeps a normal request untouched", () => {
    expect(capNote("No onions please")).toBe("No onions please");
  });

  it("trims a forged note to the cap the field enforces", () => {
    const long = "test ".repeat(200);
    expect(capNote(long)).toHaveLength(NOTE_MAX);
  });

  it("treats blank and whitespace as no note", () => {
    expect(capNote("")).toBeUndefined();
    expect(capNote("   ")).toBeUndefined();
    expect(capNote(null)).toBeUndefined();
    expect(capNote(undefined)).toBeUndefined();
  });

  it("trims surrounding whitespace", () => {
    expect(capNote("  gluten free  ")).toBe("gluten free");
  });
});
