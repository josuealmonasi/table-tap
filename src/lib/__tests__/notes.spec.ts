import { describe, expect, it } from "vitest";
import { NAME_MAX, capName, NOTE_MAX, capNote } from "@/lib/notes";

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

describe("the name a walk-in gives at the counter", () => {
  it("collapses the whitespace it will be read aloud from", () => {
    expect(capName("  Ana   María \n López ")).toBe("Ana María López");
  });

  it("treats blank as no name given, because it is optional", () => {
    expect(capName("")).toBeUndefined();
    expect(capName("   ")).toBeUndefined();
    expect(capName(null)).toBeUndefined();
    expect(capName(undefined)).toBeUndefined();
  });

  it("caps a name that would not fit on a slip", () => {
    expect(capName("x".repeat(200))).toHaveLength(NAME_MAX);
  });
});
