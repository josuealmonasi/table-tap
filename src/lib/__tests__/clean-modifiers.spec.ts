import { describe, expect, it } from "vitest";
import type { Modifier } from "@/lib/types";
import { cleanModifiers } from "@/lib/clean-modifiers";

describe("the option groups a product is saved with", () => {
  it("keeps a required group required", () => {
    const [g] = cleanModifiers([
      { label: " Size ", type: "single", options: ["S", " M "], required: true },
    ] as Modifier[]);
    expect(g).toEqual({
      label: "Size",
      type: "single",
      options: ["S", "M"],
      required: true,
    });
  });

  it("drops a group with no name or no choices, and blank choices", () => {
    const groups = [
      { label: "", type: "single", options: ["a"] },
      { label: "Milk", type: "multi", options: ["  ", ""] },
      { label: "Spice", type: "single", options: ["mild", " "] },
    ] as Modifier[];
    expect(cleanModifiers(groups)).toEqual([
      { label: "Spice", type: "single", options: ["mild"] },
    ]);
  });
});
