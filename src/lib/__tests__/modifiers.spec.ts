import { describe, expect, it } from "vitest";
import { missingRequired, satisfiesRequired } from "../modifiers";
import type { Modifier } from "../types";

const doneness: Modifier = {
  label: "Doneness",
  type: "single",
  options: ["Rare", "Medium", "Well done"],
  required: true,
};
const sauces: Modifier = {
  label: "Sauces",
  type: "multi",
  options: ["Garlic", "Chilli"],
  required: true,
};
const optionalSide: Modifier = {
  label: "Side",
  type: "single",
  options: ["Fries", "Salad"],
};

describe("missingRequired", () => {
  it("reports a required single-choice group with no answer", () => {
    expect(missingRequired([doneness], {})).toEqual(["Doneness"]);
  });

  it("accepts a required single-choice group once chosen", () => {
    expect(missingRequired([doneness], { Doneness: "Medium" })).toEqual([]);
  });

  it("treats an empty multi-select as unanswered", () => {
    // The group was touched and then cleared — same as never choosing.
    expect(missingRequired([sauces], { Sauces: [] })).toEqual(["Sauces"]);
  });

  it("accepts a multi-select with at least one choice", () => {
    expect(missingRequired([sauces], { Sauces: ["Garlic"] })).toEqual([]);
  });

  it("ignores groups that aren't required", () => {
    expect(missingRequired([optionalSide], {})).toEqual([]);
  });

  it("treats a blank string as unanswered", () => {
    expect(missingRequired([doneness], { Doneness: "   " })).toEqual(["Doneness"]);
  });

  it("reports every unanswered group, in order", () => {
    expect(missingRequired([doneness, sauces, optionalSide], {})).toEqual([
      "Doneness",
      "Sauces",
    ]);
  });

  it("handles undefined mods — a line that carries none at all", () => {
    expect(missingRequired([doneness], undefined)).toEqual(["Doneness"]);
  });

  it("is empty for a product with no modifiers", () => {
    expect(missingRequired([], {})).toEqual([]);
  });

  it("leaves modifiers saved before `required` existed unblocked", () => {
    // The field is optional, so every group stored previously has no flag and
    // must keep behaving exactly as it did — absent means not required.
    const legacy: Modifier = { label: "Spice", type: "single", options: ["Hot"] };
    expect(missingRequired([legacy], {})).toEqual([]);
  });
});

describe("satisfiesRequired", () => {
  it("is false while anything is outstanding", () => {
    expect(satisfiesRequired([doneness, sauces], { Doneness: "Rare" })).toBe(false);
  });

  it("is true once everything required is answered", () => {
    expect(
      satisfiesRequired([doneness, sauces], { Doneness: "Rare", Sauces: ["Chilli"] }),
    ).toBe(true);
  });
});
