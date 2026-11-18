import { expect, it } from "vitest";
import { chooseDish } from "../../../scripts/layout-dish-choice.mjs";

it("chooses the largest promoted dish independent of menu order", () => {
  const shapes = [
    { index: 0, name: "Plain", extras: 9, deal: false },
    { index: 1, name: "B", extras: 2, deal: true },
    { index: 2, name: "A", extras: 2, deal: true },
    { index: 3, name: "C", extras: 4, deal: true },
  ];
  expect(chooseDish(shapes)?.name).toBe("C");
  expect(chooseDish([...shapes].reverse())?.name).toBe("C");
  expect(chooseDish(shapes.slice(0, 3))?.name).toBe("A");
});
